import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.js';
import {createD1Port} from '../src/platform/async-sql-ports.js';
import {migrateAsyncTenantStore} from '../src/platform/async-tenant-migrations.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

function localD1(db){
 // Real D1 schedules batches atomically. Keep the in-memory SQLite fake
 // serialized too, otherwise two async tests can open overlapping BEGINs.
 let queue=Promise.resolve();
 return {
  prepare(sql){return {bind(...args){return {
   async first(){return db.prepare(sql).get(...args);},
   async all(){return {results:db.prepare(sql).all(...args)};},
   async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}
  }}}},
  async batch(statements){
   const job=queue.then(async()=>{
     db.exec('BEGIN IMMEDIATE');
     try{
       const output=[];for(const s of statements)output.push(await s.run());
       db.exec('COMMIT');return output;
     }catch(error){db.exec('ROLLBACK');throw error;}
   });
   queue=job.then(()=>undefined,()=>undefined);
   return job;
  }
 };
}
test('D1 async workshop core creates customer, vehicle and work order in canonical tables',async()=>{
 const db=openDatabase(':memory:');
 try{
  const port=createD1Port({binding:localD1(db)});
  await migrateAsyncTenantStore(port);
  const workshop=createAsyncWorkshopServices(port);
  const c=await workshop.createCustomer({name:'Cliente Real',phone:'16999999999'});
  const m=await workshop.createMachine({customerId:c.id,type:'AUTOMOVEL',brand:'Fiat',model:'Uno'});
  const os=await workshop.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Ruído na suspensão'});
  assert.equal(os.status,'ENTRADA');
  assert.equal(os.os_number,1);
  assert.equal((await workshop.getWorkOrder(os.id)).id,os.id);
  assert.equal((await port.all('SELECT * FROM work_order_status_history WHERE work_order_id=?',[os.id])).length,1);
  const second=await workshop.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Novo serviço'});
  assert.equal(second.os_number,2);
  await assert.rejects(workshop.createWorkOrder({customerId:999,machineId:m.id,problemReported:'Erro'}),/Cliente/);
 }finally{db.close();}
});
test('D1 async workshop posts stock and receipts atomically without double payment',async()=>{
 const db=openDatabase(':memory:');
 try{
  const port=createD1Port({binding:localD1(db)});
  await migrateAsyncTenantStore(port);
  const workshop=createAsyncWorkshopServices(port);
  const c=await workshop.createCustomer({name:'Empresa A'});
  const m=await workshop.createMachine({customerId:c.id,type:'TRATOR'});
  const os=await workshop.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Troca de peça'});
  const part=await workshop.createPart({sku:'KIT-001',description:'Kit de peças',salePriceCents:2000});
  await workshop.postStockMovement({partId:part.id,type:'ENTRADA',quantity:5});
  await workshop.postStockMovement({partId:part.id,type:'SAIDA_MANUAL',quantity:2});
  await assert.rejects(workshop.postStockMovement({partId:part.id,type:'SAIDA_MANUAL',quantity:100}),/Estoque insuficiente/);
  assert.equal((await port.first('SELECT quantity FROM parts WHERE id=?',[part.id])).quantity,3);
  assert.equal((await port.first('SELECT SUM(quantity_delta) total FROM inventory_movements WHERE part_id=?',[part.id])).total,3);
  const now=new Date().toISOString();
  await port.run(`INSERT INTO quotes(work_order_id,subtotal_cents,discount_cents,total_cents,approval_status,approved_at,created_at,updated_at)
    VALUES(?,2000,0,2000,'APROVADO',?,?,?)`,[os.id,now,now,now]);
  await port.run('UPDATE work_orders SET quote_total_cents=2000 WHERE id=?',[os.id]);
  const first=await workshop.receivePayment({workOrderId:os.id,amountCents:1500,method:'PIX',requestId:'async-pay-001'});
  const repeat=await workshop.receivePayment({workOrderId:os.id,amountCents:1500,method:'PIX',requestId:'async-pay-001'});
  assert.equal(first.id,repeat.id);
  await assert.rejects(workshop.receivePayment({workOrderId:os.id,amountCents:1000,method:'PIX',requestId:'async-pay-002'}),/Saldo insuficiente/);
  assert.equal((await port.all('SELECT * FROM payment_events')).length,1);
  const summary=await workshop.financeSummary();
  assert.equal(summary.receivedCents,1500);
  assert.equal(summary.pendingCents,500);
 }finally{db.close();}
});

test('async D1 quote approval and fiscal draft preserve original amounts and idempotency',async()=>{
 const db=openDatabase(':memory:');
 try{
  const port=createD1Port({binding:localD1(db)});
  await migrateAsyncTenantStore(port);
  const ws=createAsyncWorkshopServices(port);
  const c=await ws.createCustomer({name:'Cliente Fiscal'});
  const machine=await ws.createMachine({customerId:c.id,type:'AUTOMOVEL'});
  const os=await ws.createWorkOrder({customerId:c.id,machineId:machine.id,problemReported:'Troca'});
  await ws.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
  const quote=await ws.saveQuote({workOrderId:os.id,items:[
    {kind:'PECA',description:'Filtro',quantity:2,unitPriceCents:1500},
    {kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:1200}
  ],discountCents:200});
  assert.equal(quote.total_cents,4000);
  const approved=await ws.approveQuote({workOrderId:os.id});
  assert.equal(approved.approval_status,'APROVADO');
  assert.equal((await ws.getWorkOrder(os.id)).quote_total_cents,4000);
  const fiscal=await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFE',requestId:'d1-fiscal-001'});
  const again=await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFE',requestId:'d1-fiscal-001'});
  assert.equal(fiscal.id,again.id);
  assert.equal(fiscal.amount_cents,2857,'proportional discount allocation must close exact cents');
  assert.equal(fiscal.status,'RASCUNHO');
  assert.equal((await port.all('SELECT * FROM fiscal_events WHERE document_id=?',[fiscal.id])).length,1);
  assert.equal((await port.all('SELECT * FROM fiscal_documents')).length,1);
 }finally{db.close();}
});

test('D1 concurrent identical payment requests remain exactly once in canonical ledger',async()=>{
 const db=openDatabase(':memory:');
 try{
  const port=createD1Port({binding:localD1(db)});
  await migrateAsyncTenantStore(port);
  const workshop=createAsyncWorkshopServices(port);
  const customer=await workshop.createCustomer({name:'Cliente idempotente'});
  const vehicle=await workshop.createMachine({customerId:customer.id,type:'AUTOMOVEL'});
  const order=await workshop.createWorkOrder({
    customerId:customer.id,machineId:vehicle.id,problemReported:'Teste concorrência PIX'
  });
  const now=new Date().toISOString();
  await port.run(`INSERT INTO quotes(
    work_order_id,subtotal_cents,discount_cents,total_cents,approval_status,
    approved_at,created_at,updated_at
  ) VALUES(?,1000,0,1000,'APROVADO',?,?,?)`,[order.id,now,now,now]);
  await port.run('UPDATE work_orders SET quote_total_cents=1000 WHERE id=?',[order.id]);
  const command={workOrderId:order.id,amountCents:300,method:'PIX',requestId:'payment-concurrent-d1'};
  const [first,second]=await Promise.all([
    workshop.receivePayment(command),workshop.receivePayment(command)
  ]);
  assert.equal(first.id,second.id);
  assert.equal((await port.first('SELECT COUNT(*) n FROM receipts')).n,1);
  assert.equal((await port.first('SELECT COUNT(*) n FROM payment_events')).n,1);
  assert.equal((await workshop.financeSummary()).receivedCents,300);
 }finally{db.close();}
});
