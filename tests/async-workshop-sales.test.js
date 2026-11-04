import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('one shared SQL sales engine keeps cash, stock, sales and payments canonical on local SQLite',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const service=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const customer=await service.createCustomer({name:'Cliente balcão'});
  const part=await service.createPart({sku:'FILTRO-FA',description:'Filtro de ar',salePriceCents:1800});
  await service.postStockMovement({partId:part.id,type:'ENTRADA',quantity:5});
  const work=await service.createService({code:'REVISAO',name:'Revisão',priceCents:2500});
  const opened=await service.openCashSession({openingCents:5000,requestId:'cash-open-001'});
  assert.equal(opened.status,'ABERTO');
  const input={customerId:customer.id,paymentMethod:'DINHEIRO',cashSessionId:opened.id,
   items:[{partId:part.id,quantity:2},{serviceId:work.id,quantity:1}],
   discountCents:100,requestId:'shared-sale-001'};
  const sale=await service.createSale(input);
  const again=await service.createSale(input);
  assert.equal(sale.id,again.id);
  assert.equal(sale.total_cents,6000);
  assert.equal((await service.getSale(sale.id)).items.length,2);
  assert.equal((await service.listSales()).length,1);
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE source_type='SALE_ITEM'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_events WHERE source_type='SALE'").get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements').get().n,1);
  const canceled=await service.cancelSale({saleId:sale.id,reason:'Devolução autorizada'});
  assert.equal(canceled.status,'CANCELADA');
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,5);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE source_type='SALE_RETURN'").get().n,1);
  assert.equal(db.prepare("SELECT SUM(amount_cents) s FROM payment_events WHERE source_type='SALE'").get().s,0);
  assert.equal(db.prepare("SELECT SUM(amount_cents) s FROM cash_movements").get().s,0);
  await assert.rejects(service.cancelSale({saleId:sale.id,reason:'Devolução duplicada'}),/cancelada/i);
  const closed=await service.closeCashSession({closingCents:5000});
  assert.equal(closed.status,'FECHADO');
  await assert.rejects(service.createSale({...input,requestId:'new-sale'}),/caixa aberto/i);
 }finally{db.close();}
});
test('shared SQL sales engine rejects insufficient aggregated stock before creating fiscal or payment entries',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const service=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const part=await service.createPart({sku:'TEST-QTY',description:'Item',salePriceCents:100});
  await service.postStockMovement({partId:part.id,type:'ENTRADA',quantity:2});
  await service.openCashSession({requestId:'cash-open-stock'});
  await assert.rejects(service.createSale({paymentMethod:'DINHEIRO',requestId:'sale-too-many',
   items:[{partId:part.id,quantity:2},{partId:part.id,quantity:2}]}),/Estoque insuficiente/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,2);
 }finally{db.close();}
});
