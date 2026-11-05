import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
import {createPaymentCollection,generateStaticPix,checkPixCrc} from '../src/platform/payment-collection.js';

async function fixture(options={}){
 const db=openDatabase(':memory:');
 migrate(db);migrateAssistencia(db);
 const port=createCommonDataAdapter({engine:'sqlite',db});
 const services=createAsyncWorkshopServices(port);
 const customer=await services.createCustomer({name:'Cliente Pix'});
 const machine=await services.createMachine({customerId:customer.id,type:'TRATOR'});
 const order=await services.createWorkOrder({customerId:customer.id,machineId:machine.id,problemReported:'Reparo'});
 const diagnosis=await services.transitionWorkOrder({workOrderId:order.id,toStatus:'DIAGNOSTICO',expectedVersion:order.version});
 await services.saveQuote({workOrderId:order.id,items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:10000}]});
 await services.approveQuote({workOrderId:order.id});
 return {db,port,services,order,collection:createPaymentCollection(port,{receivePayment:services.receivePayment,getPaymentSummary:services.getPaymentSummary,...options})};
}

test('Pix estático monta BR Code verificável sem dependência de API paga',()=>{
 const br=generateStaticPix({pixKey:'12345678909',merchantName:'OFICINA TESTE',merchantCity:'RIBEIRAO PRETO',amountCents:1250,txid:'TESTE123'});
 assert.match(br,/^000201/);
 assert.ok(br.includes('br.gov.bcb.pix'));
 assert.ok(br.includes('12.50'));
 assert.ok(checkPixCrc(br));
 assert.equal(checkPixCrc(br.slice(0,-1)+(br.endsWith('0')?'1':'0')),false);
});

test('intenção Pix estática não quita OS sem confirmação do banco ou baixa manual explícita',async()=>{
 const {db,order,collection,services}=await fixture({pixStatic:{pixKey:'chave@example.com',merchantName:'OFICINA',merchantCity:'UBERABA'}});
 try{
  const args={workOrderId:order.id,amountCents:2000,method:'PIX_STATIC',requestId:'pix-estatico-1'};
  const first=await collection.createIntent(args);
  assert.equal(first.status,'PENDING');
  assert.ok(checkPixCrc(first.pix_payload));
  assert.equal((await collection.createIntent(args)).id,first.id);
  assert.equal((await services.getPaymentSummary(order.id)).receivedCents,0);
  await assert.rejects(collection.syncIntent(first.id),/confirmação automática/);
  await assert.rejects(collection.createIntent({...args,amountCents:3000}),/Idempotência/);
 }finally{db.close();}
});

test('Pix API só dá baixa ao confirmar referência e valor pelo provedor; repetição é idempotente',async()=>{
 let state='PENDING',polls=0;
 const pix={
  async create({amountCents,requestId}){return {reference:'pix-'+requestId,pixPayload:'QR-SANDBOX-'+amountCents};},
  async status(reference){polls++;assert.equal(reference,'pix-pix-api-1');return {reference,status:state,amountCents:2500};}
 };
 const {db,order,services,collection}=await fixture({providers:{PIX_API:pix}});
 try{
  const intent=await collection.createIntent({workOrderId:order.id,amountCents:2500,method:'PIX_API',requestId:'pix-api-1'});
  assert.equal(intent.status,'PENDING');
  assert.equal((await services.getPaymentSummary(order.id)).receivedCents,0);
  assert.equal((await collection.syncIntent(intent.id)).status,'PENDING');
  assert.equal((await services.getPaymentSummary(order.id)).receivedCents,0);
  state='PAID';
  const paid=await collection.syncIntent(intent.id);
  assert.equal(paid.status,'PAID');
  assert.ok(paid.receipt_id);
  assert.equal((await collection.syncIntent(intent.id)).receipt_id,paid.receipt_id);
  assert.equal((await services.getPaymentSummary(order.id)).receivedCents,2500);
  assert.equal(polls,2);
 }finally{db.close();}
});

test('TEF sem adaptador não é habilitado; valor divergente não gera receita',async()=>{
 const tef={create:async()=>({reference:'terminal-1'}),status:async()=>({reference:'terminal-1',status:'PAID',amountCents:100})};
 const {db,order,collection,services}=await fixture({providers:{TEF:tef}});
 try{
  await assert.rejects(collection.createIntent({workOrderId:order.id,amountCents:1500,method:'SMART_POS',requestId:'pos-1'}),/não configurado/);
  const intent=await collection.createIntent({workOrderId:order.id,amountCents:1500,method:'TEF',requestId:'tef-1'});
  await assert.rejects(collection.syncIntent(intent.id),/divergente/);
  assert.equal((await services.getPaymentSummary(order.id)).receivedCents,0);
 }finally{db.close();}
});

test('pagamento misto preserva baixa única e saldo canônico',async()=>{
 const provider={create:async()=>({reference:'pos-2'}),status:async()=>({reference:'pos-2',status:'PAID',amountCents:3000})};
 const {db,order,collection,services}=await fixture({providers:{SMART_POS:provider}});
 try{
  const part=await services.receivePayment({workOrderId:order.id,amountCents:2000,method:'PIX',requestId:'manual-pix-2'});
  const intent=await collection.createIntent({workOrderId:order.id,amountCents:3000,method:'SMART_POS',requestId:'pos-2'});
  await collection.syncIntent(intent.id);
  const summary=await services.getPaymentSummary(order.id);
  assert.equal(summary.receivedCents,5000);
  assert.equal(summary.pendingCents,5000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n,2);
  assert.ok(part.id);
 }finally{db.close();}
});

test('recebimento confirmado por provedor não pode ser estornado só no livro local',async()=>{
 const provider={create:async()=>({reference:'tef-live-1'}),status:async()=>({
  reference:'tef-live-1',status:'PAID',amountCents:3500
 })};
 const {db,order,collection,services}=await fixture({providers:{TEF:provider}});
 try{
  const intent=await collection.createIntent({workOrderId:order.id,amountCents:3500,method:'TEF',requestId:'tef-live-1'});
  const settled=await collection.syncIntent(intent.id);
  await assert.rejects(services.reverseReceipt({workOrderId:order.id,receiptId:settled.receipt_id,note:'Solicitado'}),/provedor.*estorno/i);
  assert.equal((await services.getPaymentSummary(order.id)).receivedCents,3500);
 }finally{db.close();}
});
