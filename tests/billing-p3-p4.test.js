import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
import {createBillingService,splitInstallments} from '../src/platform/billing-p3-p4.js';

async function setup(extra={}){
 const db=openDatabase(':memory:');
 migrate(db);migrateAssistencia(db);
 const port=createCommonDataAdapter({engine:'sqlite',db});
 const core=createAsyncWorkshopServices(port);
 const customer=await core.createCustomer({name:'Oficina P3'});
 const machine=await core.createMachine({customerId:customer.id,type:'CARRO'});
 const created=await core.createWorkOrder({customerId:customer.id,machineId:machine.id,problemReported:'Motor'});
 await core.transitionWorkOrder({workOrderId:created.id,toStatus:'DIAGNOSTICO',expectedVersion:created.version});
 await core.saveQuote({workOrderId:created.id,items:[{kind:'MAO_DE_OBRA',description:'Reparo',quantity:1,unitPriceCents:10001}]});
 await core.approveQuote({workOrderId:created.id});
 return {db,core,order:created,billing:createBillingService(port,{
  receivePayment:core.receivePayment,getPaymentSummary:core.getPaymentSummary,...extra
 })};
}
test('P3 divide centavos sem perda, calendário mensal respeita último dia',()=>{
 assert.deepEqual(splitInstallments(10001,3),[3334,3334,3333]);
 assert.deepEqual(splitInstallments(10000,3),[3334,3333,3333]);
});
test('P3 gera plano único, parcelas fecham o saldo; idempotência rejeita mudanças',async()=>{
 const {db,core,order,billing}=await setup();
 try{
  const plan=await billing.createPlan({workOrderId:order.id,amountCents:10001,
   count:3,firstDueDate:'2026-01-31',method:'MANUAL',requestId:'parcelamento-1'});
  assert.equal(plan.installments.length,3);
  assert.equal(plan.installments.reduce((t,x)=>t+x.amount_cents,0),10001);
  assert.deepEqual(plan.installments.map(i=>i.due_date),['2026-01-31','2026-02-28','2026-03-31']);
  assert.equal((await billing.createPlan({workOrderId:order.id,amountCents:10001,count:3,
   firstDueDate:'2026-01-31',method:'MANUAL',requestId:'parcelamento-1'})).id,plan.id);
  await assert.rejects(billing.createPlan({workOrderId:order.id,amountCents:10000,count:3,
   firstDueDate:'2026-01-31',method:'MANUAL',requestId:'parcelamento-1'}),/idempotência/i);
  await assert.rejects(billing.createPlan({workOrderId:order.id,amountCents:10001,count:3,
   firstDueDate:'2026-01-31',method:'MANUAL',requestId:'parcelamento-2'}),/plano/i);
  assert.equal((await core.getPaymentSummary(order.id)).receivedCents,0);
 }finally{db.close();}
});
test('P3 boleto/link exige provedor e NUNCA registra receita antes de confirmação',async()=>{
 const provider={create:async({requestId,amountCents})=>({reference:'asaas-'+requestId,paymentUrl:'https://www.asaas.com/i/exemplo'}),
  status:async ref=>({reference:ref,status:'PENDING',amountCents:10001})};
 const {db,core,order,billing}=await setup({providers:{BOLETO:provider}});
 try{
  const plan=await billing.createPlan({workOrderId:order.id,amountCents:10001,count:1,
    firstDueDate:'2026-12-15',method:'BOLETO',requestId:'boleto-1'});
  const activated=await billing.activateInstallment(plan.installments[0].id);
  assert.equal(activated.status,'PENDING');
  assert.equal(activated.payment_url,'https://www.asaas.com/i/exemplo');
  assert.equal((await core.getPaymentSummary(order.id)).receivedCents,0);
  assert.equal((await billing.syncInstallment(activated.id)).status,'PENDING');
  assert.equal((await core.getPaymentSummary(order.id)).receivedCents,0);
 }finally{db.close();}
});
test('P3 liquidação conferida baixa parcela uma só vez; divergência bloqueia',async()=>{
 let confirmed=false;
 const provider={create:async()=>({reference:'asaas-charge-1',paymentUrl:'https://www.asaas.com/i/teste'}),
  status:async()=>({reference:'asaas-charge-1',status:confirmed?'PAID':'PENDING',amountCents:10001})};
 const {db,core,order,billing}=await setup({providers:{PAYMENT_LINK:provider}});
 try{
  const plan=await billing.createPlan({workOrderId:order.id,amountCents:10001,count:1,
   firstDueDate:'2026-12-15',method:'PAYMENT_LINK',requestId:'link-1'});
  const intent=await billing.activateInstallment(plan.installments[0].id);
  assert.equal((await billing.syncInstallment(intent.id)).status,'PENDING');
  confirmed=true;
  const paid=await billing.syncInstallment(intent.id);
  assert.equal(paid.status,'PAID');
  assert.equal((await billing.syncInstallment(intent.id)).receipt_id,paid.receipt_id);
  assert.equal((await core.getPaymentSummary(order.id)).receivedCents,10001);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  await assert.rejects(core.reverseReceipt({workOrderId:order.id,receiptId:paid.receipt_id}),/estorno externo/i);
 }finally{db.close();}
});
test('P4 conciliação de extrato não gera uma segunda receita e exige valor exato',async()=>{
 const {db,core,order,billing}=await setup();
 try{
  const plan=await billing.createPlan({workOrderId:order.id,amountCents:10001,count:1,
   firstDueDate:'2026-11-10',method:'MANUAL',requestId:'manual-1'});
  await assert.rejects(billing.confirmManual(plan.installments[0].id,{verified:false}),/confirmação/i);
  const paid=await billing.confirmManual(plan.installments[0].id,{verified:true});
  const bank=await billing.importStatement({bankAccount:'conta-matriz',externalId:'bank-001',
   bookedAt:'2026-11-10',amountCents:10001,description:'PIX cliente'});
  assert.equal((await billing.importStatement({bankAccount:'conta-matriz',externalId:'bank-001',
   bookedAt:'2026-11-10',amountCents:10001,description:'PIX cliente'})).id,bank.id);
  await assert.rejects(billing.importStatement({bankAccount:'conta-matriz',externalId:'bank-001',
   bookedAt:'2026-11-10',amountCents:200,description:'PIX cliente'}),/idempotência/i);
  const matched=await billing.matchStatement(bank.id,paid.receipt_id);
  assert.equal(matched.receipt_id,paid.receipt_id);
  assert.equal((await core.getPaymentSummary(order.id)).receivedCents,10001);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
 }finally{db.close();}
});
test('P4 taxas e repasses não alteram receita bruta; lembretes ficam somente em rascunho',async()=>{
 const {db,core,order,billing}=await setup();
 try{
  const plan=await billing.createPlan({workOrderId:order.id,amountCents:10001,count:2,
   firstDueDate:'2026-11-05',method:'MANUAL',requestId:'manual-2'});
  const first=await billing.confirmManual(plan.installments[0].id,{verified:true});
  const s=await billing.recordSettlement({installmentId:first.id,feeCents:150,
   settledAt:'2026-11-06',requestId:'repasse-1'});
  assert.equal(s.gross_cents,5001);
  assert.equal(s.net_cents,4851);
  assert.equal((await billing.recordSettlement({installmentId:first.id,feeCents:150,
   settledAt:'2026-11-06',requestId:'repasse-1'})).id,s.id);
  const drafts=await billing.prepareReminders({asOf:'2026-12-20',daysAhead:7});
  assert.equal(drafts.length,1);
  assert.equal(drafts[0].status,'DRAFT');
  assert.equal((await billing.prepareReminders({asOf:'2026-12-20',daysAhead:7})).length,1);
  const report=await billing.financeReport({asOf:'2026-12-20'});
  assert.equal(report.grossReceivedCents,5001);
  assert.equal(report.feeCents,150);
  assert.equal(report.netSettledCents,4851);
  assert.equal((await core.getPaymentSummary(order.id)).receivedCents,5001);
 }finally{db.close();}
});

test('P4 mostra recebimentos elegíveis por OS, sem pedir IDs numéricos ao operador',async()=>{
 const {db,order,billing}=await setup();
 try{
  const plan=await billing.createPlan({workOrderId:order.id,amountCents:10001,count:1,
   firstDueDate:'2026-11-05',method:'MANUAL',requestId:'manual-selector'});
  const installment=await billing.confirmManual(plan.installments[0].id,{verified:true});
  const available=await billing.listAvailableReceipts();
  assert.equal(available.length,1);
  assert.equal(available[0].id,installment.receipt_id);
  assert.ok(available[0].os_number);
  const bank=await billing.importStatement({bankAccount:'conta-principal',
   externalId:'bank-receipt-list',bookedAt:'2026-11-05',amountCents:10001,description:'Recebimento OS'});
  await billing.matchStatement(bank.id,installment.receipt_id);
  assert.equal((await billing.listAvailableReceipts()).length,0);
 }finally{db.close();}
});

test('P3 impede emissão duplicada quando duas sessões tentam ativar a mesma parcela',async()=>{
 let releases,created=0;
 const barrier=new Promise(resolve=>{releases=resolve});
 const provider={create:async()=>{created++;await barrier;return {
  reference:'boleto-unico',paymentUrl:'https://www.asaas.com/i/boleto'
 }},status:async()=>({reference:'boleto-unico',status:'PENDING',amountCents:10001})};
 const {db,order,billing}=await setup({providers:{BOLETO:provider}});
 try{
  const plan=await billing.createPlan({workOrderId:order.id,amountCents:10001,
   count:1,firstDueDate:'2026-12-15',method:'BOLETO',requestId:'concorrente-1'});
  const one=billing.activateInstallment(plan.installments[0].id);
  // O segundo pedido chega enquanto o primeiro ainda aguarda o PSP.
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(billing.activateInstallment(plan.installments[0].id),/emissão.*andamento/i);
  releases();
  await one;
  assert.equal(created,1);
 }finally{releases();db.close();}
});
