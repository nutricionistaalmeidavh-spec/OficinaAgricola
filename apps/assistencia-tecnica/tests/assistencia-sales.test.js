import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createPart, addInventoryMovement } from '../src/services/inventory.js';
import {
  createService,
  openCashSession,
  createSale,
  cashSummary,
  cancelSale,
  closeCashSession,
} from '../src/services/sales.js';

function dbReady() {
  const db = openDatabase(':memory:');
  migrate(db);
  migrateAssistencia(db);
  return db;
}

test('versão assistência mantém banco próprio com catálogo de serviços', () => {
  const db = dbReady();
  const service = createService(db, { code: 'FORM', name: 'Formatação', priceCents: 15000, estimatedMinutes: 90 });
  assert.equal(service.code, 'FORM');
  assert.equal(service.price_cents, 15000);
  assert.equal(db.prepare('SELECT name FROM company_settings WHERE id=1').get().name, 'Assistência Técnica ArtiSys');
  db.close();
});

test('venda de balcão baixa estoque, entra no caixa e cancelamento estorna', () => {
  const db = dbReady();
  const part = createPart(db, { sku: 'SSD-480', description: 'SSD 480 GB', salePriceCents: 24000, minStock: 1 });
  addInventoryMovement(db, part.id, { type: 'ENTRADA', quantity: 5 });
  const service = createService(db, { code: 'INST', name: 'Instalação', priceCents: 8000 });
  openCashSession(db, { openingCents: 10000 });

  const sale = createSale(db, {
    paymentMethod: 'DINHEIRO',
    items: [
      { partId: part.id, quantity: 1 },
      { serviceId: service.id, quantity: 1 },
    ],
  });

  assert.equal(sale.total_cents, 32000);
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity, 4);
  assert.equal(cashSummary(db).expectedCashCents, 42000);

  const canceled = cancelSale(db, sale.id, { reason: 'Teste de estorno' });
  assert.equal(canceled.status, 'CANCELADA');
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity, 5);
  assert.equal(cashSummary(db).expectedCashCents, 10000);

  const closed = closeCashSession(db, { closingCents: 10000 });
  assert.equal(closed.status, 'FECHADO');
  assert.equal(closed.difference_cents, 0);
  db.close();
});
