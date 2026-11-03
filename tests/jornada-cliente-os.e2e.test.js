import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createUser } from '../src/auth.js';
import { seedDefaultChecklists } from '../src/services/operations.js';
import { createAppServer } from '../src/server.js';

async function workshop(t) {
  const db = openDatabase(':memory:');
  migrate(db);
  migrateAssistencia(db);
  seedDefaultChecklists(db);
  createUser(db, { username: 'admin', password: 'Admin@1234', role: 'ADMIN', name: 'Administrador QA' });
  createUser(db, { username: 'financeiro', password: 'Admin@1234', role: 'FINANCEIRO', name: 'Financeiro QA' });
  const storageDir = mkdtempSync(join(tmpdir(), 'oficina-jornada-e2e-'));
  const server = createAppServer({ db, storageDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(storageDir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, { method = 'GET', token, body, binary = false } = {}) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    return {
      status: response.status,
      data: binary ? data : (data ? (response.headers.get('content-type') || '').includes('json') ? JSON.parse(data) : data : null)
    };
  }
  const login = await request('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'Admin@1234' }
  });
  assert.equal(login.status, 200, 'Login administrativo');
  const admin = login.data.token;
  async function ok(path, options = {}) {
    const result = await request(path, { ...options, token: options.token || admin });
    assert.ok(result.status >= 200 && result.status < 300,
      path + ' -> ' + result.status + ': ' + JSON.stringify(result.data).slice(0, 300));
    return result.data;
  }
  return { db, request, ok, admin };
}

test('Jornada real: cliente -> carro -> OS -> diagnostico -> orcamento -> pecas -> recebimento -> entrega', async t => {
  const { db, ok } = await workshop(t);
  const customer = await ok('/api/customers', {
    method: 'POST', body: { name: 'Cliente Jornada E2E', phone: '16999990000', email: 'qa@example.invalid' }
  });
  const vehicle = await ok('/api/machines', {
    method: 'POST', body: {
      customerId: customer.id, type: 'Carro', brand: 'Volkswagen', model: 'Gol', year: 2020,
      plate: 'ABC1D23', vin: '9BWZZZ377VT004251', odometerKm: 48200,
      renavam: '12345678901', engine: '1.6 MSI', fuelType: 'FLEX'
    }
  });
  assert.equal(vehicle.customer_id, customer.id);
  assert.equal(vehicle.license_plate, 'ABC1D23');
  assert.equal(vehicle.odometer_km, 48200);
  const technician = await ok('/api/technicians', { method: 'POST', body: { name: 'Tecnico Jornada QA' } });
  const order = await ok('/api/work-orders', {
    method: 'POST', body: {
      customerId: customer.id, machineId: vehicle.id, technicianId: technician.id,
      problemReported: 'Motor falhando e revisao de oleo', priority: 'ALTA',
      requestId: 'qa-journey-create'
    }
  });
  assert.equal(order.status, 'ENTRADA');
  assert.equal(JSON.parse(order.snapshot_machine).licensePlate, 'ABC1D23');
  const orderPath = '/api/work-orders/' + order.id;
  async function advance(status) {
    const current = await ok(orderPath);
    return ok(orderPath + '/status', {
      method: 'POST', body: { status, expectedVersion: current.version, requestId: 'qa-journey-' + status }
    });
  }
  await advance('DIAGNOSTICO');
  const beforeDiagnosis = await ok(orderPath);
  await ok(orderPath, {
    method: 'PATCH', body: { diagnosis: 'Filtro de oleo saturado', expectedVersion: beforeDiagnosis.version }
  });
  const quote = await ok(orderPath + '/quote', {
    method: 'PUT', body: {
      items: [
        { kind: 'MAO_DE_OBRA', description: 'Revisao preventiva', quantity: 1, unitPriceCents: 15000 },
        { kind: 'PECA', description: 'Filtro de oleo', quantity: 1, unitPriceCents: 5000 }
      ],
      discountCents: 1000
    }
  });
  assert.equal(quote.total_cents, 19000);
  assert.equal((await ok(orderPath)).status, 'ORCAMENTO');
  await ok(orderPath + '/quote/submit', { method: 'POST', body: {} });
  assert.equal((await ok(orderPath)).status, 'AGUARDANDO_APROVACAO');
  await ok(orderPath + '/quote/approve', { method: 'POST', body: {} });
  assert.equal((await ok(orderPath)).status, 'APROVADA');

  const part = await ok('/api/parts', {
    method: 'POST', body: { sku: 'QA-FILTRO-001', description: 'Filtro de oleo Gol', salePriceCents: 5000, minStock: 1 }
  });
  await ok('/api/parts/' + part.id + '/fitments', {
    method: 'POST', body: { brand: 'Volkswagen', model: 'Gol', yearFrom: 2018, yearTo: 2022 }
  });
  const compatible = await ok('/api/machines/' + vehicle.id + '/compatible-parts');
  assert.ok(compatible.some(p => p.id === part.id), 'Filtro aparece compativel com o veiculo');
  await ok('/api/inventory/movements', {
    method: 'POST', body: { partId: part.id, type: 'ENTRADA', quantity: 3, requestId: 'qa-journey-stock' }
  });
  await ok(orderPath + '/parts', {
    method: 'POST', body: { partId: part.id, quantity: 1, requestId: 'qa-journey-consumption' }
  });
  const stock = await ok('/api/parts');
  assert.equal(stock.find(p => p.id === part.id).quantity, 2, 'A OS baixou exatamente uma unidade');
  assert.equal((await ok(orderPath + '/parts')).length, 1);

  const templates = await ok('/api/checklist-templates');
  const entry = templates.find(item => item.kind === 'ENTRADA');
  assert.ok(entry, 'Existe checklist de entrada');
  const checklist = await ok('/api/checklist-templates/' + entry.id);
  const answers = checklist.items.map(item => ({ position: item.position, response: 'OK' }));
  await ok(orderPath + '/checklists', {
    method: 'POST', body: { templateId: entry.id, responses: answers }
  });
  assert.equal((await ok(orderPath + '/checklists')).length, 1);
  await ok(orderPath + '/attachments', {
    method: 'POST', body: {
      category: 'DIAGNOSTICO', caption: 'Evidencia QA',
      originalName: 'inspecao.jpg', mimeType: 'image/jpeg',
      base64: Buffer.from('foto-e2e').toString('base64')
    }
  });
  assert.equal((await ok(orderPath + '/attachments')).length, 1);
  await advance('EM_SERVICO');
  await advance('PRONTA');

  await ok(orderPath + '/receipts', {
    method: 'POST', body: { amountCents: 9000, method: 'PIX', requestId: 'qa-journey-pix' }
  });
  assert.deepEqual(await ok(orderPath + '/payment'),
    { totalCents: 19000, receivedCents: 9000, pendingCents: 10000, status: 'PARCIAL' });
  await ok('/api/cash/open', { method: 'POST', body: { openingCents: 0 } });
  await ok(orderPath + '/receipts', {
    method: 'POST', body: { amountCents: 10000, method: 'DINHEIRO', requestId: 'qa-journey-cash' }
  });
  assert.deepEqual(await ok(orderPath + '/payment'),
    { totalCents: 19000, receivedCents: 19000, pendingCents: 0, status: 'PAGO' });
  await advance('ENTREGUE');
  assert.equal((await ok('/api/machines/' + vehicle.id + '/history'))[0].status, 'ENTREGUE');
  const pdf = await ok(orderPath + '/documents/work-order/pdf', { binary: true });
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal((await ok(orderPath + '/history')).some(item => item.type === 'STATUS'), true);
  assert.equal((await ok('/api/admin/reconciliation')).errors.length, 0,
    'Livros canonicos de estoque/pagamentos/caixa conciliados');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n, 2,
    'Duas parcelas, sem cobranca duplicada');
});

test('Jornada de excecoes: bloqueia veiculo alheio, salto de status e edicao concorrente', async t => {
  const { ok, request, admin } = await workshop(t);
  const a = await ok('/api/customers', { method: 'POST', body: { name: 'Cliente A' } });
  const b = await ok('/api/customers', { method: 'POST', body: { name: 'Cliente B' } });
  const car = await ok('/api/machines', {
    method: 'POST', body: { customerId: a.id, type: 'Carro', brand: 'Fiat', model: 'Uno' }
  });
  const wrongVehicle = await request('/api/work-orders', {
    method: 'POST', token: admin,
    body: { customerId: b.id, machineId: car.id, problemReported: 'Vinculo invalido' }
  });
  assert.ok(wrongVehicle.status >= 400, 'Nao mistura carro de outro cliente');
  const os = await ok('/api/work-orders', {
    method: 'POST', body: { customerId: a.id, machineId: car.id, problemReported: 'Vazamento' }
  });
  const invalidJump = await request('/api/work-orders/' + os.id + '/status', {
    method: 'POST', token: admin, body: { status: 'ENTREGUE', expectedVersion: os.version }
  });
  assert.ok(invalidJump.status >= 400, 'Nao entrega uma OS diretamente da entrada');
  const first = await ok('/api/work-orders/' + os.id);
  await ok('/api/work-orders/' + os.id, {
    method: 'PATCH', body: { diagnosis: 'Inspecao inicial', expectedVersion: first.version }
  });
  const staleEdit = await request('/api/work-orders/' + os.id, {
    method: 'PATCH', token: admin, body: { diagnosis: 'Sobrescrita', expectedVersion: first.version }
  });
  assert.ok(staleEdit.status >= 400, 'Bloqueia sobrescrita com versao antiga');
  assert.equal((await ok('/api/work-orders/' + os.id)).diagnosis, 'Inspecao inicial');
  assert.equal((await request('/api/work-orders/' + os.id)).status, 401, 'OS exige login');
});

test('Jornada de reprovacao: cliente recusa, orcamento e revisado e depois aprovado', async t => {
  const { ok } = await workshop(t);
  const customer = await ok('/api/customers', {
    method: 'POST', body: { name: 'Cliente Recusou Primeiro Orcamento' }
  });
  const machine = await ok('/api/machines', {
    method: 'POST', body: { customerId: customer.id, type: 'Carro', brand: 'Chevrolet', model: 'Onix' }
  });
  const os = await ok('/api/work-orders', {
    method: 'POST', body: { customerId: customer.id, machineId: machine.id, problemReported: 'Freio fazendo barulho' }
  });
  const path = '/api/work-orders/' + os.id;
  await ok(path + '/status', {
    method: 'POST', body: { status: 'DIAGNOSTICO', expectedVersion: os.version }
  });
  await ok(path + '/quote', { method: 'PUT', body: {
    items: [{ kind: 'MAO_DE_OBRA', description: 'Servico inicial', quantity: 1, unitPriceCents: 20000 }]
  } });
  await ok(path + '/quote/submit', { method: 'POST', body: {} });
  await ok(path + '/quote/reject', { method: 'POST', body: { reason: 'Acima do orcamento do cliente' } });
  assert.equal((await ok(path)).status, 'REPROVADA');
  assert.equal((await ok(path + '/quote')).rejection_reason, 'Acima do orcamento do cliente');
  await ok(path + '/quote', { method: 'PUT', body: {
    discountCents: 2000,
    items: [{ kind: 'MAO_DE_OBRA', description: 'Servico revisado', quantity: 1, unitPriceCents: 15000 }]
  } });
  assert.equal((await ok(path)).status, 'ORCAMENTO');
  await ok(path + '/quote/submit', { method: 'POST', body: {} });
  await ok(path + '/quote/approve', { method: 'POST', body: {} });
  assert.equal((await ok(path)).status, 'APROVADA');
  assert.equal((await ok(path + '/payment')).totalCents, 13000);
});
