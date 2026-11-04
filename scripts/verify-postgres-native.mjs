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
 const nativeAdmin=await service.bootstrapAdmin({
  username:'pg-admin',name:'PG Admin',password:'PostgresScrypt#2026'
 });
 const nativeLogin=await service.login({
  username:'pg-admin',password:'PostgresScrypt#2026'
 });
 assert.equal(nativeLogin.user.id,nativeAdmin.id);
 assert.equal((await service.validateSession(nativeLogin.token)).role,'ADMIN');
 const nativeClerk=await service.createUser({
  username:'pg-clerk',name:'Cashier',password:'PostgresCashier#2026',
  role:'ATENDIMENTO'
 },nativeLogin.token);
 assert.equal(nativeClerk.role,'ATENDIMENTO');
 await service.logout(nativeLogin.token);
 await assert.rejects(service.validateSession(nativeLogin.token),/Sessão inválida/);

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
 // Multi-user concurrency must not allocate MAX(os_number)+1 twice.
 // PostgreSQL's unique index is an invariant, not a reason to lose an OS.
 const simultaneous=await Promise.all(Array.from({length:12},(_,i)=>
  service.createWorkOrder({customerId:customer.id,machineId:machine.id,
   problemReported:'PG concorrência '+i})
 ));
 assert.equal(new Set(simultaneous.map(os=>Number(os.os_number))).size,12,
   'each concurrent OS must receive a unique canonical number');

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
 const repeatedCommand={workOrderId:order.id,amountCents:500,
  method:'PIX',requestId:'pg-parity-concurrent-001'};
 const [sameA,sameB]=await Promise.all([
  service.receivePayment(repeatedCommand),service.receivePayment(repeatedCommand)
 ]);
 assert.equal(String(sameA.id),String(sameB.id));
 assert.equal(Number((await port.first('SELECT COUNT(*) n FROM receipts')).n),2);
 assert.equal(Number((await port.first('SELECT COUNT(*) n FROM payment_events')).n),2);
 assert.equal((await service.financeSummary()).receivedCents,2500);
 const session=await service.openCashSession({openingCents:3000,requestId:'pg-full-cash-open'});
 const serviceItem=await service.createService({code:'PG-SERVICO-001',name:'Mão de obra',priceCents:800});
 const sale=await service.createSale({cashSessionId:session.id,paymentMethod:'DINHEIRO',
   items:[{partId:part.id,quantity:1},{serviceId:serviceItem.id,quantity:1}],
   requestId:'pg-sale-001'});
 assert.equal(sale.total_cents,6800);
 assert.equal((await service.createSale({cashSessionId:session.id,paymentMethod:'DINHEIRO',
   items:[{partId:part.id,quantity:1},{serviceId:serviceItem.id,quantity:1}],
   requestId:'pg-sale-001'})).id,sale.id);
 await service.cancelSale({saleId:sale.id,reason:'Devolução por QA'});
 assert.equal((await service.getSale(sale.id)).status,'CANCELADA');
 const cash=await service.cashSummary();
 assert.equal(cash.movementTotalCents,0);
 assert.equal((await service.closeCashSession({closingCents:3000})).status,'FECHADO');

 // Real PostgreSQL verification of the same automotive workflows already
 // required by SQLite and local D1.
 const fitting=await service.savePartFitment(part.id,{brand:'Fiat',model:'Uno'});
 assert.equal((await service.listCompatibleParts(machine.id))[0].id,part.id);
 await service.deletePartFitment(part.id,fitting.id);
 assert.equal((await service.listCompatibleParts(machine.id)).length,0);
 const plan=await service.createMaintenancePlan(machine.id,{
  name:'Revisão semestral',intervalDays:180,startingDate:'2026-05-01'
 });
 assert.equal(plan.next_due_date,'2026-10-28');
 const alert=await service.listMaintenanceAlerts({today:'2026-11-04'});
 assert.ok(alert.some(row=>row.id===plan.id),'overdue maintenance must be reported');
 const completed=await service.completeMaintenancePlan(plan.id,{performedAt:'2026-11-04'});
 assert.equal(completed.last_completed_at,'2026-11-04');
 assert.equal((await service.listServiceRecords(machine.id)).length,1);
 await assert.rejects(service.completeMaintenancePlan(plan.id,{performedAt:'2026-11-04'}),
   /já concluído/);
 console.log('PostgreSQL 16 real: OS, caixa, estorno, estoque, aplicações de peças e manutenção preventiva OK');
}finally{await pool.end();}
