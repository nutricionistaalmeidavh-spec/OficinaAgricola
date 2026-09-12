import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, migrate } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createAssistenciaServer } from '../src/server-assistencia.js';
import { createEventRuntime } from '../src/platform/event-runtime.js';
import { describeHttpMutation } from '../src/platform/http-event-bridge.js';
import { DOMAIN_EVENT_TYPES } from '../src/platform/events.js';

async function request(base, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`);
  return data;
}

test('runtime de eventos persiste auditoria e isola falha de integração opcional', async () => {
  const root = mkdtempSync(join(tmpdir(), 'assistencia-events-'));
  const errors = [];
  try {
    const runtime = createEventRuntime({
      auditPath: join(root, 'events.jsonl'),
      logger: { error: (...args) => errors.push(args.join(' ')) },
      integrations: [{
        name: 'opcional-indisponivel',
        types: [DOMAIN_EVENT_TYPES.SALE_COMPLETED],
        handle() { throw new Error('integração fora do ar'); },
      }],
    });

    const event = await runtime.emit(DOMAIN_EVENT_TYPES.SALE_COMPLETED, { saleId: 7, totalCents: 19990 });
    assert.equal(event.type, DOMAIN_EVENT_TYPES.SALE_COMPLETED);
    assert.equal(runtime.audit.readAll().length, 1);
    assert.match(errors.join('\n'), /integração fora do ar/);
    runtime.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ponte HTTP mapeia mutações críticas para eventos de domínio', () => {
  const cases = [
    ['POST', '/api/work-orders', { id: 11, os_number: 2026, status: 'ABERTA' }, DOMAIN_EVENT_TYPES.WORK_ORDER_CREATED],
    ['POST', '/api/work-orders/11/status', { status: 'DIAGNOSTICO' }, DOMAIN_EVENT_TYPES.WORK_ORDER_STATUS_CHANGED],
    ['POST', '/api/work-orders/11/quote/approve', { id: 3, total_cents: 50000 }, DOMAIN_EVENT_TYPES.QUOTE_APPROVED],
    ['POST', '/api/inventory/movements', { id: 4, part_id: 9, type: 'ENTRADA', quantity: 2 }, DOMAIN_EVENT_TYPES.INVENTORY_MOVED],
    ['POST', '/api/work-orders/11/receipts', { id: 6, amount_cents: 50000, method: 'PIX' }, DOMAIN_EVENT_TYPES.PAYMENT_REGISTERED],
    ['POST', '/api/sales', { id: 8, total_cents: 7500, payment_method: 'DINHEIRO' }, DOMAIN_EVENT_TYPES.SALE_COMPLETED],
    ['POST', '/api/sales/8/cancel', { status: 'CANCELADA' }, DOMAIN_EVENT_TYPES.SALE_CANCELLED],
    ['POST', '/api/cash/open', { id: 1, opening_cents: 10000 }, DOMAIN_EVENT_TYPES.CASH_OPENED],
    ['POST', '/api/cash/current/movements', { id: 2, cash_session_id: 1, type: 'SANGRIA', amount_cents: 2000 }, DOMAIN_EVENT_TYPES.CASH_MOVED],
    ['POST', '/api/cash/current/close', { id: 1, closing_cents: 8000, difference_cents: 0 }, DOMAIN_EVENT_TYPES.CASH_CLOSED],
  ];

  for (const [method, path, data, expectedType] of cases) {
    assert.equal(describeHttpMutation(method, path, data)?.type, expectedType, `${method} ${path}`);
  }
  assert.equal(describeHttpMutation('GET', '/api/work-orders', {}), null);
});

test('servidor da assistência publica eventos reais de OS, estoque, venda e caixa', async (t) => {
  const db = openDatabase(':memory:');
  migrate(db);
  migrateAssistencia(db);
  createUser(db, { username: 'admin', password: 'Admin@1234', role: 'ADMIN', name: 'Administrador' });
  const seen = [];
  const eventRuntime = createEventRuntime({
    integrations: [{ name: 'captura-teste', handle: event => seen.push(event) }],
    logger: { error() {} },
  });
  const app = createAssistenciaServer({ db, storageDir: '/tmp/assistencia-event-uploads', eventRuntime });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => { eventRuntime.close(); app.close(); db.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;

  const auth = await request(base, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin@1234' } });
  const token = auth.token;
  const customer = await request(base, '/api/customers', { method: 'POST', token, body: { name: 'Cliente Evento' } });
  const machine = await request(base, '/api/machines', { method: 'POST', token, body: { customerId: customer.id, type: 'Notebook', brand: 'Dell', model: 'Latitude' } });
  const tech = await request(base, '/api/technicians', { method: 'POST', token, body: { name: 'Técnico Evento' } });
  const os = await request(base, '/api/work-orders', { method: 'POST', token, body: { customerId: customer.id, machineId: machine.id, technicianId: tech.id, problemReported: 'Não liga' } });
  await request(base, `/api/work-orders/${os.id}/status`, { method: 'POST', token, body: { status: 'DIAGNOSTICO' } });

  const part = await request(base, '/api/parts', { method: 'POST', token, body: { sku: 'EVT-1', description: 'Peça Evento', salePriceCents: 5000, minStock: 1 } });
  await request(base, '/api/inventory/movements', { method: 'POST', token, body: { partId: part.id, type: 'ENTRADA', quantity: 3 } });
  const service = await request(base, '/api/services', { method: 'POST', token, body: { code: 'EVT', name: 'Serviço Evento', priceCents: 2500 } });
  await request(base, '/api/cash/open', { method: 'POST', token, body: { openingCents: 10000 } });
  const sale = await request(base, '/api/sales', { method: 'POST', token, body: { paymentMethod: 'DINHEIRO', items: [{ partId: part.id, quantity: 1 }, { serviceId: service.id, quantity: 1 }] } });
  await request(base, `/api/sales/${sale.id}/cancel`, { method: 'POST', token, body: { reason: 'Teste' } });
  await request(base, '/api/cash/current/close', { method: 'POST', token, body: { closingCents: 10000 } });

  await new Promise(resolve => setImmediate(resolve));
  const types = new Set(seen.map(event => event.type));
  for (const type of [
    DOMAIN_EVENT_TYPES.WORK_ORDER_CREATED,
    DOMAIN_EVENT_TYPES.WORK_ORDER_STATUS_CHANGED,
    DOMAIN_EVENT_TYPES.INVENTORY_MOVED,
    DOMAIN_EVENT_TYPES.CASH_OPENED,
    DOMAIN_EVENT_TYPES.SALE_COMPLETED,
    DOMAIN_EVENT_TYPES.SALE_CANCELLED,
    DOMAIN_EVENT_TYPES.CASH_CLOSED,
  ]) assert.equal(types.has(type), true, `evento ausente: ${type}`);
});
