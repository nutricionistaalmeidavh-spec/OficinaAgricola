import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EventBus } from '../src/platform/event-bus.js';
import { createDomainEvent, DOMAIN_EVENT_TYPES } from '../src/platform/events.js';
import { AuditLog } from '../src/platform/audit-log.js';
import { createBackup, restoreBackup } from '../src/platform/backup.js';
import { LocalJobQueue } from '../src/platform/job-queue.js';
import { listLanUrls, resolveServerConfig } from '../src/platform/network.js';

test('EventBus publica em assinantes específicos e permite unsubscribe', async () => {
  const bus = new EventBus();
  const seen = [];
  const unsubscribe = bus.subscribe(DOMAIN_EVENT_TYPES.WORK_ORDER_STATUS_CHANGED, event => seen.push(event.payload.status));
  await bus.publish(createDomainEvent(DOMAIN_EVENT_TYPES.WORK_ORDER_STATUS_CHANGED, { status: 'PRONTA' }, { actorId: 'u1' }));
  unsubscribe();
  await bus.publish(createDomainEvent(DOMAIN_EVENT_TYPES.WORK_ORDER_STATUS_CHANGED, { status: 'ENTREGUE' }, { actorId: 'u1' }));
  assert.deepEqual(seen, ['PRONTA']);
});

test('AuditLog consome wildcard do EventBus e persiste JSONL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oficina-audit-'));
  try {
    const filePath = join(dir, 'audit.jsonl');
    const bus = new EventBus();
    const audit = new AuditLog({ filePath });
    const detach = audit.attach(bus);
    await bus.publish(createDomainEvent(DOMAIN_EVENT_TYPES.PAYMENT_REGISTERED, { amountCents: 15000 }, { actorId: 'financeiro-1', correlationId: 'os-22' }));
    detach();
    const entries = audit.readAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, DOMAIN_EVENT_TYPES.PAYMENT_REGISTERED);
    assert.equal(entries[0].actorId, 'financeiro-1');
    assert.equal(entries[0].correlationId, 'os-22');
    assert.equal(entries[0].payload.amountCents, 15000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backup/restauração preserva banco e anexos e valida checksum', () => {
  const root = mkdtempSync(join(tmpdir(), 'oficina-backup-'));
  try {
    const databasePath = join(root, 'db.sqlite');
    const uploadsPath = join(root, 'uploads');
    const backupRoot = join(root, 'backups');
    mkdirSync(join(uploadsPath, 'os-1'), { recursive: true });
    writeFileSync(databasePath, 'database-v1');
    writeFileSync(join(uploadsPath, 'os-1', 'foto.txt'), 'foto-v1');
    const backup = createBackup({ databasePath, uploadsPath, backupRoot, now: new Date('2026-09-11T15:00:00.000Z') });
    writeFileSync(databasePath, 'database-alterado');
    writeFileSync(join(uploadsPath, 'os-1', 'foto.txt'), 'foto-alterada');
    restoreBackup({ backupDir: backup.backupDir, databasePath, uploadsPath });
    assert.equal(readFileSync(databasePath, 'utf8'), 'database-v1');
    assert.equal(readFileSync(join(uploadsPath, 'os-1', 'foto.txt'), 'utf8'), 'foto-v1');
    writeFileSync(join(backup.backupDir, 'database.sqlite'), 'corrompido');
    assert.throws(() => restoreBackup({ backupDir: backup.backupDir, databasePath, uploadsPath }), /integridade/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('LocalJobQueue executa FIFO, reporta tamanho correto e drain espera esvaziamento', async () => {
  const queue = new LocalJobQueue();
  const order = [];
  queue.register('work', async payload => { order.push(payload.id); });
  queue.enqueue('work', { id: 1 });
  queue.enqueue('work', { id: 2 });
  assert.equal(queue.size, 2);
  await queue.drain();
  assert.deepEqual(order, [1, 2]);
  assert.equal(queue.size, 0);
});

test('configuração LAN usa 0.0.0.0 e lista IPv4 acessível', () => {
  assert.deepEqual(resolveServerConfig({ PORT: '4123' }), { host: '0.0.0.0', port: 4123 });
  const urls = listLanUrls({ port: 4123, interfaces: { lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], wlan0: [{ address: '192.168.0.50', family: 'IPv4', internal: false }] } });
  assert.deepEqual(urls, ['http://192.168.0.50:4123']);
});

test('PWA mantém API fora do cache e registra shell', () => {
  const index = readFileSync('public/index.html', 'utf8');
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(index, /manifest\.webmanifest/);
  assert.match(index, /pwa-register\.js/);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.start_url);
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /networkResponse/);
});
