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
  listSales,
  getSale,
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
  assert.equal(db.prepare('SELECT name FROM company_settings WHERE id=1').get().name, 'ArtiSys Oficina');
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

test('cancelamento sem motivo não modifica a venda, estoque ou caixa', () => {
  const db = dbReady();
  const part = createPart(db, { sku: 'SAFE-001', description: 'Peça teste', salePriceCents: 2500 });
  addInventoryMovement(db, part.id, { type: 'ENTRADA', quantity: 2 });
  openCashSession(db, { openingCents: 1000 });
  const sale = createSale(db, { paymentMethod: 'DINHEIRO', items: [{ partId: part.id, quantity: 1 }] });
  const cashBefore = cashSummary(db).expectedCashCents;
  assert.throws(() => cancelSale(db, sale.id, { reason: '' }), /Motivo do cancelamento obrigatório/);
  assert.throws(() => cancelSale(db, sale.id, { reason: '  ' }), /Motivo do cancelamento obrigatório/);
  assert.equal(getSale(db, sale.id).status, 'CONCLUIDA');
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity, 1);
  assert.equal(cashSummary(db).expectedCashCents, cashBefore);
  const reversed = db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE source_type='SALE_RETURN'").get().n;
  assert.equal(reversed, 0);
  db.close();
});

test('busca de vendas para o fiscal filtra por número e status sem cortar o histórico', () => {
  const db = dbReady();
  const service = createService(db, { code: 'FISCAL-1', name: 'Mão de obra', priceCents: 9000 });
  openCashSession(db, { openingCents: 0 });
  const sale = createSale(db, { paymentMethod: 'DINHEIRO', items: [{ serviceId: service.id, quantity: 1 }] });
  const completed = listSales(db, { search: String(sale.sale_number), status: 'CONCLUIDA', limit: 50 });
  assert.ok(completed.some(item => item.id === sale.id));
  cancelSale(db, sale.id, { reason: 'Devolução confirmada' });
  assert.ok(!listSales(db, { search: String(sale.sale_number), status: 'CONCLUIDA' }).some(item => item.id === sale.id));
  assert.ok(listSales(db, { search: String(sale.sale_number), status: 'CANCELADA' }).some(item => item.id === sale.id));
  db.close();
});
