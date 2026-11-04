#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createD1Port} from '../src/platform/async-sql-ports.js';
import {migrateAsyncTenantStore} from '../src/platform/async-tenant-migrations.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

// Real local workerd+D1 emulator, not a SQLite DatabaseSync mock.
// Does not need a Cloudflare account or access production databases.
if(process.env.CI!=='true')throw Error('Teste nativo D1 deve rodar apenas em CI');
let Miniflare;
try{({Miniflare}=await import('miniflare'));}
catch{throw Error('Instale miniflare open source explicitamente somente no CI');}
const mf=new Miniflare({
 modules:true,compatibilityDate:'2026-11-03',
 script:"export default {fetch(){return new Response('D1 offline testing')}}",
 d1Databases:{DB:'e5accc11-2e2e-4444-8888-555555555555'}
});
try{
 const binding=await mf.getD1Database('DB');
 const port=createD1Port({binding});
 await migrateAsyncTenantStore(port);
 await migrateAsyncTenantStore(port);
 const service=createAsyncWorkshopServices(port);
 const customer=await service.createCustomer({name:'QA D1 Worker Real'});
 const machine=await service.createMachine({customerId:customer.id,type:'AUTOMOVEL',brand:'VW'});
 const os=await service.createWorkOrder({
  customerId:customer.id,machineId:machine.id,problemReported:'Teste D1 real'
 });
 assert.equal(os.status,'ENTRADA');
 assert.equal((await service.getWorkOrder(os.id)).id,os.id);
 const part=await service.createPart({
  sku:'D1-PARITY-001',description:'Peça teste',salePriceCents:4500
 });
 await service.postStockMovement({partId:part.id,type:'ENTRADA',quantity:4});
 await service.postStockMovement({partId:part.id,type:'SAIDA_MANUAL',quantity:1});
 await assert.rejects(
  service.postStockMovement({partId:part.id,type:'SAIDA_MANUAL',quantity:99}),
  /Estoque insuficiente/
 );
 const stock=await port.first('SELECT quantity FROM parts WHERE id=?',[part.id]);
 assert.equal(Number(stock.quantity),3);
 const now=new Date().toISOString();
 await port.run(`INSERT INTO quotes(
  work_order_id,subtotal_cents,discount_cents,total_cents,approval_status,
  approved_at,created_at,updated_at
 ) VALUES (?,4500,0,4500,'APROVADO',?,?,?)`,[os.id,now,now,now]);
 await port.run('UPDATE work_orders SET quote_total_cents=4500 WHERE id=?',[os.id]);
 const a=await service.receivePayment({
  workOrderId:os.id,amountCents:2000,method:'PIX',requestId:'d1-local-pay-001'
 });
 const b=await service.receivePayment({
  workOrderId:os.id,amountCents:2000,method:'PIX',requestId:'d1-local-pay-001'
 });
 assert.equal(a.id,b.id);
 await assert.rejects(
  service.receivePayment({workOrderId:os.id,amountCents:4000,
   method:'PIX',requestId:'d1-local-pay-overflow'}),
  /Saldo insuficiente/
 );
 const summary=await service.financeSummary();
 assert.equal(summary.receivedCents,2000);
 assert.equal(summary.pendingCents,2500);
 const events=await port.first('SELECT COUNT(*) n FROM payment_events');
 assert.equal(events.n,1);
 console.log('Cloudflare D1 local Workerd: schema, OS, estoque, pagamento e idempotência OK');
}finally{await mf.dispose();}
