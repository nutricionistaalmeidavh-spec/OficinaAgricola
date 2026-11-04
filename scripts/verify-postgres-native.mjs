#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPostgresPort } from '../src/platform/async-sql-ports.js';
import { createAsyncWorkshopServices } from '../src/platform/async-workshop-services.js';
import { migrateAsyncTenantStore } from '../src/platform/async-tenant-migrations.js';

// Safety: only run on CI against an ephemeral loopback PostgreSQL instance.
if(process.env.CI!=='true'||!process.env.POSTGRES_TEST_URL)
  throw Error('Este teste exige CI=true e POSTGRES_TEST_URL de teste descartável');
const endpoint=new URL(process.env.POSTGRES_TEST_URL);
if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))
  throw Error('O teste recusa PostgreSQL fora do runner local');

let Pool;
try{({Pool}=await import('pg'));}
catch{throw Error('Instale a dependência opcional open source pg para testar PostgreSQL');}
const pool=new Pool({connectionString:process.env.POSTGRES_TEST_URL,max:3,
 connectionTimeoutMillis:8000,statement_timeout:15000});
try{
 const port=createPostgresPort({pool});
 await migrateAsyncTenantStore(port);
 await migrateAsyncTenantStore(port);
 const service=createAsyncWorkshopServices(port);
 const customer=await service.createCustomer({name:'QA Native PostgreSQL'});
 assert.equal(customer.name,'QA Native PostgreSQL');
 const machine=await service.createMachine({
  customerId:customer.id,type:'AUTOMOVEL',brand:'Fiat',model:'Uno'
 });
 const order=await service.createWorkOrder({
  customerId:customer.id,machineId:machine.id,problemReported:'Teste transacional'
 });
 assert.equal(order.status,'ENTRADA');
 assert.ok(Number(order.os_number)>0);
 const part=await service.createPart({
  sku:'PG-PARITY-001',description:'Componente de regressão',salePriceCents:6000
 });
 await service.postStockMovement({partId:part.id,type:'ENTRADA',quantity:5});
 await service.postStockMovement({partId:part.id,type:'SAIDA_MANUAL',quantity:2});
 await assert.rejects(
  service.postStockMovement({partId:part.id,type:'SAIDA_MANUAL',quantity:100}),
  /Estoque insuficiente/
 );
 const inventory=await port.first('SELECT quantity FROM parts WHERE id=?',[part.id]);
 assert.equal(Number(inventory.quantity),3);
 const now=new Date().toISOString();
 await port.run(`INSERT INTO quotes(
   work_order_id,subtotal_cents,discount_cents,total_cents,approval_status,
   approved_at,created_at,updated_at
 ) VALUES (?,6000,0,6000,'APROVADO',?,?,?)`,[order.id,now,now,now]);
 await port.run('UPDATE work_orders SET quote_total_cents=6000 WHERE id=?',[order.id]);
 const paid=await service.receivePayment({
  workOrderId:order.id,amountCents:2000,method:'PIX',requestId:'pg-parity-pay-001'
 });
 const replay=await service.receivePayment({
  workOrderId:order.id,amountCents:2000,method:'PIX',requestId:'pg-parity-pay-001'
 });
 assert.equal(String(paid.id),String(replay.id));
 await assert.rejects(
  service.receivePayment({workOrderId:order.id,amountCents:5000,method:'PIX',
   requestId:'pg-parity-pay-overflow'}),/Saldo insuficiente/
 );
 const summary=await service.financeSummary();
 assert.equal(summary.receivedCents,2000);
 assert.equal(summary.pendingCents,4000);
 const payments=await port.first('SELECT COUNT(*) n FROM payment_events');
 assert.equal(Number(payments.n),1);
 console.log('PostgreSQL 16 real: schema, OS, estoque e pagamento idempotente OK');
}finally{await pool.end();}
