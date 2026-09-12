import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { hashPassword, verifyPassword, createUser, login, validateSession } from '../src/auth.js';

test('migration creates the operational schema with foreign keys enabled', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  for (const required of ['users','sessions','customers','machines','technicians','work_orders','work_order_status_history','quotes','quote_items','parts','inventory_movements','schedule_events','checklist_templates','checklist_template_items','work_order_checklists','checklist_responses','attachments','receipts','expenses','company_settings']) {
    assert.equal(names.has(required), true, `missing ${required}`);
  }
  db.close();
});

test('password hashing uses a salt and never stores plaintext', () => {
  const a = hashPassword('segredo-forte');
  const b = hashPassword('segredo-forte');
  assert.notEqual(a, b);
  assert.equal(a.includes('segredo-forte'), false);
  assert.equal(verifyPassword('segredo-forte', a), true);
  assert.equal(verifyPassword('errada', a), false);
});

test('local login creates a persisted session and validates it', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  createUser(db, { username: 'admin', password: 'forte-123', role: 'ADMIN', name: 'Administrador' });
  const session = login(db, 'admin', 'forte-123');
  assert.ok(session.token.length >= 40);
  const current = validateSession(db, session.token);
  assert.equal(current.username, 'admin');
  assert.equal(current.role, 'ADMIN');
  assert.throws(() => login(db, 'admin', 'errada'), /Credenciais inválidas/);
  db.close();
});
