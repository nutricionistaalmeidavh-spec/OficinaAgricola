import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createUser } from '../src/auth.js';
import { createAssistenciaServer } from '../src/server-assistencia.js';
import { runVerifiedBackupCycle } from '../src/platform/backup-scheduler.js';
import { restoreBackup } from '../src/platform/backup.js';

// Testes de contrato pela API real + SQLite real no disco, sem serviços externos.
async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'oficina-resiliencia-'));
  const databasePath = join(root, 'oficina.sqlite');
  const storageDir = join(root, 'uploads');
  let db = openDatabase(databasePath);
  migrate(db);
  migrateAssistencia(db);
  for (const role of ['ADMIN', 'ATENDIMENTO', 'TECNICO', 'FINANCEIRO']) {
    createUser(db, { username: role.toLowerCase(), password: 'Admin@1234', role, name: 'QA ' + role });
  }
  let server = null;
  let base = '';
  let admin = '';
  async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
    const h = { ...headers };
    const authorization = token === undefined ? admin : token;
    if (authorization) h.Authorization = 'Bearer ' + authorization;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await res.arrayBuffer();
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? JSON.parse(Buffer.from(raw).toString('utf8')) : Buffer.from(raw);
    return { status: res.status, data };
  }
  async function login(role) {
    const result = await request('/api/auth/login', { method: 'POST', token: null,
      body: { username: role.toLowerCase(), password: 'Admin@1234' } });
    assert.equal(result.status, 200, 'Login ' + role);
    return result.data.token;
  }
  async function start() {
    server = createAssistenciaServer({ db, storageDir });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    admin = await login('ADMIN');
  }
  async function stop() {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
    if (db) {
      db.close();
      db = null;
    }
  }
  async function restart() {
    await stop();
    db = openDatabase(databasePath);
    await start();
  }
  async function ok(path, options = {}) {
    const res = await request(path, options);
    assert.equal(res.status, 200, path + ' ' + res.status + ' ' + JSON.stringify(res.data).slice(0, 250));
    return res.data;
  }
  async function order(label = 'Reparo') {
    const c = await ok('/api/customers', { method: 'POST', body: { name: 'Cliente ' + label } });
    const v = await ok('/api/machines', { method: 'POST',
      body: { customerId: c.id, type: 'Carro', brand: 'Volkswagen', model: 'Polo' } });
    const os = await ok('/api/work-orders', { method: 'POST',
      body: { customerId: c.id, machineId: v.id, problemReported: label } });
    return { c, v, os, path: '/api/work-orders/' + os.id };
  }
  async function approvedOrder(label, amount = 12000) {
    const item = await order(label);
    await ok(item.path + '/status', { method: 'POST',
      body: { status: 'DIAGNOSTICO', expectedVersion: item.os.version } });
    await ok(item.path + '/quote', { method: 'PUT', body: {
      items: [{ kind: 'MAO_DE_OBRA', description: 'Reparo aprovado', quantity: 1, unitPriceCents: amount }]
    } });
    await ok(item.path + '/quote/submit', { method: 'POST', body: {} });
    await ok(item.path + '/quote/approve', { method: 'POST', body: {} });
    return item;
  }
  t.after(async () => { await stop(); rmSync(root, { recursive: true, force: true }); });
  await start();
  return { request, ok, login, order, approvedOrder, restart, stop,
    get db() { return db; }, root, databasePath, storageDir };
}

test('P0: duplo clique e resposta perdida nao criam OS duplicada e conflito de versao impede sobrescrita', async t => {
  const s = await setup(t);
  const c = await s.ok('/api/customers', { method: 'POST', body: { name: 'Cliente resiliencia' } });
  const v = await s.ok('/api/machines', { method: 'POST',
    body: { customerId: c.id, type: 'Carro', brand: 'Fiat', model: 'Argo' } });
  const command = { customerId: c.id, machineId: v.id, problemReported: 'Revisao',
    requestId: 'e2e-double-click-order' };
  const responses = await Promise.all([0, 1].map(() => s.request('/api/work-orders', { method: 'POST', body: command })));
  assert.deepEqual(responses.map(x => x.status), [200, 200]);
  assert.equal(responses[0].data.id, responses[1].data.id);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM work_orders').get().n, 1);
  const changedCommand = await s.request('/api/work-orders', { method: 'POST',
    body: { ...command, problemReported: 'Alteracao usando a mesma chave' } });
  assert.ok(changedCommand.status >= 400, 'Nao aceita mesma chave com payload diferente');
  const os = responses[0].data;
  const roles = await Promise.all([s.login('ATENDIMENTO'), s.login('TECNICO')]);
  const mutations = await Promise.all(roles.map((token, i) => s.request('/api/work-orders/' + os.id, {
    method: 'PATCH', token,
    body: { diagnosis: 'Tecnico ' + i, expectedVersion: os.version }
  })));
  assert.deepEqual(mutations.map(x => x.status).sort((a, b) => a - b), [200, 409]);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM work_order_change_history WHERE work_order_id=? AND field=?')
    .get(os.id, 'diagnosis').n, 1);
  assert.equal((await s.ok('/api/admin/reconciliation')).errors.length, 0);
});

test('P0: pagamentos concorrentes, idempotencia e saldo pendente nunca geram cobranca a mais', async t => {
  const s = await setup(t);
  const { os, path } = await s.approvedOrder('PIX simultaneo', 12000);
  const body = { amountCents: 8000, method: 'PIX', requestId: 'e2e-pix-once' };
  const duplicated = await Promise.all([0, 1].map(() => s.request(path + '/receipts', { method: 'POST', body })));
  assert.deepEqual(duplicated.map(x => x.status), [200, 200]);
  assert.equal(duplicated[0].data.id, duplicated[1].data.id);
  const overpay = await Promise.all(['pix-extra-a', 'pix-extra-b'].map(requestId =>
    s.request(path + '/receipts', { method: 'POST', body: { amountCents: 4000, method: 'PIX', requestId } })));
  assert.deepEqual(overpay.map(x => x.status).sort((a, b) => a - b), [200, 409]);
  assert.deepEqual(await s.ok(path + '/payment'),
    { totalCents: 12000, receivedCents: 12000, pendingCents: 0, status: 'PAGO' });
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM receipts WHERE work_order_id=?').get(os.id).n, 2);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM payment_events').get().n, 2);
  assert.equal((await s.ok('/api/admin/reconciliation')).ok, true);
});

test('P1: cancelamento exige primeiro estorno de pecas e de recebimentos ativos', async t => {
  const s = await setup(t);
  const { os, path } = await s.approvedOrder('Cancelamento sem perda', 9000);
  const part = await s.ok('/api/parts', { method: 'POST',
    body: { sku: 'QA-CANCEL-' + os.id, description: 'Filtro cancelamento', salePriceCents: 1000 } });
  await s.ok('/api/inventory/movements', { method: 'POST',
    body: { partId: part.id, type: 'ENTRADA', quantity: 3 } });
  const item = await s.ok(path + '/parts', { method: 'POST',
    body: { partId: part.id, quantity: 2, requestId: 'qa-consume-part' } });
  const cancel = async () => {
    const current = await s.ok(path);
    return s.request(path + '/status', { method: 'POST',
      body: { status: 'CANCELADA', expectedVersion: current.version } });
  };
  const withPart = await cancel();
  assert.equal(withPart.status, 409, 'Impedir cancelamento com consumo ainda nao estornado');
  await s.ok(path + '/parts/' + item.id + '/reverse', { method: 'POST', body: { note: 'Servico cancelado' } });
  assert.equal((await s.ok('/api/parts')).find(x => x.id === part.id).quantity, 3);
  const receipt = await s.ok(path + '/receipts', { method: 'POST',
    body: { amountCents: 9000, method: 'PIX', requestId: 'qa-cancel-receipt' } });
  const withReceipt = await cancel();
  assert.equal(withReceipt.status, 409, 'Impedir cancelamento com recebimento ativo');
  await s.ok(path + '/receipts/' + receipt.id + '/reverse', { method: 'POST',
    body: { note: 'Cliente reembolsado' } });
  assert.equal((await cancel()).status, 200);
  assert.equal((await s.ok(path)).status, 'CANCELADA');
  assert.deepEqual(await s.ok(path + '/payment'),
    { totalCents: 9000, receivedCents: 0, pendingCents: 0, status: 'CANCELADO' });
  const summary = await s.ok('/api/finance/summary');
  assert.equal(summary.invoicedCents, 0, 'Orcamento cancelado nao pode inflar faturamento');
  assert.equal(summary.pendingCents, 0, 'OS cancelada nao pode seguir em contas a receber');
  const lateReceipt = await s.request(path + '/receipts', { method: 'POST',
    body: { amountCents: 1000, method: 'PIX', requestId: 'qa-pagamento-apos-cancelamento' } });
  assert.equal(lateReceipt.status, 409, 'Nao aceita novo pagamento apos cancelamento');
  assert.equal(s.db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM payment_events').get().n, 0);
  assert.equal((await s.ok('/api/admin/reconciliation')).errors.length, 0);
});

test('P1: orcamento aguardando autorizacao nao pode ser modificado sem reprovar e reenviar', async t => {
  const s = await setup(t);
  const { path } = await s.order('Orcamento pendente');
  const current = await s.ok(path);
  await s.ok(path + '/status', { method: 'POST',
    body: { status: 'DIAGNOSTICO', expectedVersion: current.version } });
  await s.ok(path + '/quote', { method: 'PUT', body: {
    items: [{ kind: 'MAO_DE_OBRA', description: 'Primeira proposta', quantity: 1, unitPriceCents: 10000 }]
  } });
  await s.ok(path + '/quote/submit', { method: 'POST', body: {} });
  const invalid = await s.request(path + '/quote', { method: 'PUT', body: {
    items: [{ kind: 'MAO_DE_OBRA', description: 'Alteracao oculta', quantity: 1, unitPriceCents: 50000 }]
  } });
  assert.equal(invalid.status, 409);
  assert.equal((await s.ok(path + '/quote')).total_cents, 10000);
  assert.equal((await s.ok(path)).status, 'AGUARDANDO_APROVACAO');
  await s.ok(path + '/quote/reject', { method: 'POST', body: { reason: 'Revisao solicitada' } });
  await s.ok(path + '/quote', { method: 'PUT', body: {
    items: [{ kind: 'MAO_DE_OBRA', description: 'Proposta corrigida', quantity: 1, unitPriceCents: 8000 }]
  } });
  await s.ok(path + '/quote/submit', { method: 'POST', body: {} });
  await s.ok(path + '/quote/approve', { method: 'POST', body: {} });
  assert.equal((await s.ok(path + '/payment')).totalCents, 8000);
});

test('P2: papeis reais respeitam fronteiras de atendimento, tecnico, financeiro e administrador', async t => {
  const s = await setup(t);
  const atendimento = await s.login('ATENDIMENTO');
  const tecnico = await s.login('TECNICO');
  const financeiro = await s.login('FINANCEIRO');
  const { path } = await s.approvedOrder('Permissoes', 5000);
  assert.equal((await s.request(path, { token: tecnico })).status, 200);
  assert.equal((await s.request('/api/customers', { method: 'POST', token: tecnico,
    body: { name: 'Proibido para tecnico' } })).status, 403);
  assert.equal((await s.request(path + '/receipts', { method: 'POST', token: tecnico,
    body: { amountCents: 5000, method: 'PIX' } })).status, 403);
  assert.equal((await s.request(path, { method: 'PATCH', token: financeiro,
    body: { diagnosis: 'Financeiro nao pode editar OS', expectedVersion: (await s.ok(path)).version } })).status, 403);
  assert.equal((await s.request(path + '/quote', { method: 'PUT', token: financeiro,
    body: { items: [] } })).status, 403);
  assert.equal((await s.request(path + '/receipts', { method: 'POST', token: atendimento,
    body: { amountCents: 5000, method: 'PIX' } })).status, 403);
  assert.equal((await s.request('/api/admin/reconciliation', { token: atendimento })).status, 403);
  await s.ok(path + '/receipts', { method: 'POST', token: financeiro,
    body: { amountCents: 5000, method: 'PIX', requestId: 'qa-financeiro-role' } });
  assert.equal((await s.ok(path + '/payment')).status, 'PAGO');
});

test('P0/P3: reinicio e backup/restore preservam OS, anexo, recebimento e chave de replay', async t => {
  const s = await setup(t);
  const { os, path } = await s.approvedOrder('Persistencia fisica', 7000);
  const rbody = { amountCents: 7000, method: 'PIX', requestId: 'qa-crash-replay-payment' };
  const abody = { category: 'ENTRADA', caption: 'Foto de entrada',
    originalName: 'entrada.jpg', mimeType: 'image/jpeg',
    base64: Buffer.from('conteudo-anexo-qa').toString('base64'),
    requestId: 'qa-crash-replay-attachment' };
  const receipt = await s.ok(path + '/receipts', { method: 'POST', body: rbody });
  const attachment = await s.ok(path + '/attachments', { method: 'POST', body: abody });
  await s.restart(); // Reconexao com DB SQLite em disco (nao equivale a queda de energia real).
  assert.equal((await s.ok(path + '/receipts', { method: 'POST', body: rbody })).id, receipt.id);
  assert.equal((await s.ok(path + '/attachments', { method: 'POST', body: abody })).id, attachment.id);
  assert.equal((await s.ok(path + '/payment')).receivedCents, 7000);
  assert.equal((await s.ok(path + '/attachments')).length, 1);
  assert.equal((await s.ok(path + '/receipts')).length, 1);
  const backup = runVerifiedBackupCycle({
    databasePath: s.databasePath, uploadsPath: s.storageDir,
    backupRoot: join(s.root, 'backups'), minIntervalMs: 0
  });
  assert.equal(backup.verified, true);
  const restoredDb = join(s.root, 'restored', 'oficina.sqlite');
  const restoredUploads = join(s.root, 'restored', 'uploads');
  restoreBackup({ backupDir: backup.backupDir, databasePath: restoredDb, uploadsPath: restoredUploads });
  const restored = openDatabase(restoredDb);
  try {
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM receipts WHERE work_order_id=?').get(os.id).n, 1);
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM attachments WHERE work_order_id=?').get(os.id).n, 1);
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM command_idempotency WHERE request_id=?')
      .get(rbody.requestId).n, 1);
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { restored.close(); }
  const binary = await s.request('/api/attachments/' + attachment.id + '/file');
  assert.equal(binary.status, 200);
  assert.equal(binary.data.toString('utf8'), 'conteudo-anexo-qa');
  assert.equal((await s.ok('/api/admin/reconciliation')).errors.length, 0);
});


test('P0: queda abrupta SIGKILL apos confirmar escrita preserva pagamento e impede replay duplicado', { skip: process.platform === 'win32' }, async t => {
  const s = await setup(t);
  const { os, path } = await s.approvedOrder('Crash durabilidade', 15000);
  await s.stop();
  const probe = netServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['src/start.js'], {
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: String(port),
      DATABASE_PATH: s.databasePath, STORAGE_DIR: s.storageDir,
      EVENT_LOG_PATH: join(s.root, 'events.jsonl'), BACKUP_ROOT: join(s.root, 'backups'),
      NODE_ENV: 'test'
    },
    stdio: 'ignore'
  });
  try {
    const url = 'http://127.0.0.1:' + port;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Servidor de crash saiu antes do teste');
      try {
        if ((await fetch(url + '/api/health')).status === 200) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'Servidor de processo separado iniciou');
    const login = await fetch(url + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@1234' })
    });
    assert.equal(login.status, 200);
    const token = (await login.json()).token;
    const body = { amountCents: 15000, method: 'PIX', requestId: 'qa-process-killed-after-commit' };
    const result = await fetch(url + path + '/receipts', {
      method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer ' + token
      },
      body: JSON.stringify(body)
    });
    assert.equal(result.status, 200, 'Pagamento realmente confirmado antes de interromper o processo');
    const first = await result.json();
    child.kill('SIGKILL'); // Sem shutdown, flush, close ou backup coordenado.
    await new Promise(resolve => child.once('exit', resolve));
    await s.restart();
    const replay = await s.ok(path + '/receipts', { method: 'POST', body });
    assert.equal(replay.id, first.id);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM receipts WHERE work_order_id=?').get(os.id).n, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM payment_events').get().n, 1);
    assert.equal((await s.ok(path + '/payment')).pendingCents, 0);
    assert.equal((await s.ok('/api/admin/reconciliation')).ok, true);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
