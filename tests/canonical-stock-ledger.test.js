import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase,migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createPart, addInventoryMovement, reconcileStock } from '../src/services/inventory.js';
import { createSale, cancelSale, openCashSession } from '../src/services/sales.js';

test('estoque de balcão usa apenas inventory_movements e reconcilia com saldo',()=>{
 const db=openDatabase(':memory:');
 try{
   migrate(db);migrateAssistencia(db);
   const p=createPart(db,{sku:'CANON-STOCK',description:'Peça',salePriceCents:1000});
   addInventoryMovement(db,p.id,{type:'ENTRADA',quantity:10});
   openCashSession(db,{openingCents:0});
   const sale=createSale(db,{requestId:'stock-ledger-t1',items:[{partId:p.id,quantity:4}],paymentMethod:'DINHEIRO'});
   const out=db.prepare("SELECT * FROM inventory_movements WHERE part_id=? AND source_type='SALE_ITEM'").all(p.id);
   assert.equal(out.length,1);
   assert.equal(out[0].quantity_delta,-4);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_stock_movements').get().n,0);
   assert.equal(reconcileStock(db,p.id).difference,0);
   cancelSale(db,sale.id,{reason:'Cancelamento'});
   assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE source_type='SALE_RETURN'").get().n,1);
   assert.equal(reconcileStock(db,p.id).difference,0);
   assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(p.id).quantity,10);
 }finally{db.close()}
});

test('migração aditiva incorpora movimentos legados sem baixar estoque novamente',()=>{
 const db=openDatabase(':memory:');
 try{
   migrate(db);migrateAssistencia(db);
   const p=createPart(db,{sku:'LEGACY-STOCK',description:'Peça',salePriceCents:1000});
   addInventoryMovement(db,p.id,{type:'ENTRADA',quantity:5});
   db.exec("INSERT INTO sales(sale_number,subtotal_cents,total_cents,payment_method,status,created_at) VALUES(1,1000,1000,'PIX','CONCLUIDA','2026-01-01')");
   db.prepare("INSERT INTO sale_items(sale_id,kind,part_id,description,quantity,unit_price_cents,total_cents) VALUES(1,'PECA',?,'Peça',1,1000,1000)").run(p.id);
   db.prepare("INSERT INTO sale_stock_movements(sale_item_id,part_id,quantity_delta,created_at) VALUES(1,?,-1,'2026-01-01')").run(p.id);
   db.prepare('UPDATE parts SET quantity=4 WHERE id=?').run(p.id);
   migrateAssistencia(db);
   migrateAssistencia(db);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE source_type='SALE_ITEM'").get().n,1);
   assert.equal(reconcileStock(db,p.id).difference,0);
 }finally{db.close()}
});
