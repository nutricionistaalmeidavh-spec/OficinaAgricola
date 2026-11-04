import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('shared financial service does not accept cash without open register and books OS receipts exactly once',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const customer=await ws.createCustomer({name:'Empresa'});
  const vehicle=await ws.createMachine({customerId:customer.id,type:'TRATOR'});
  const os=await ws.createWorkOrder({customerId:customer.id,machineId:vehicle.id,problemReported:'Troca'});
  await ws.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
  await ws.saveQuote({workOrderId:os.id,items:[{kind:'MAO_DE_OBRA',description:'Reparo',quantity:1,unitPriceCents:2000}]});
  await ws.approveQuote({workOrderId:os.id});
  await assert.rejects(ws.receivePayment({workOrderId:os.id,method:'DINHEIRO',amountCents:500,
   requestId:'cash-without-register'}),/Abra o caixa/);
  const cash=await ws.openCashSession({openingCents:1000});
  const receipt=await ws.receivePayment({workOrderId:os.id,method:'DINHEIRO',amountCents:500,
   requestId:'cash-receipt-001'});
  assert.equal((await ws.receivePayment({workOrderId:os.id,method:'DINHEIRO',amountCents:500,
   requestId:'cash-receipt-001'})).id,receipt.id);
  const movements=await db.prepare('SELECT * FROM cash_movements').all();
  assert.equal(movements.length,1);
  assert.equal(movements[0].receipt_id,receipt.id);
  assert.equal(movements[0].cash_session_id,cash.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  assert.equal((await ws.cashSummary()).expectedCashCents,1500);
  assert.equal((await ws.financeSummary()).invoicedCents,2000);
 }finally{db.close();}
});
test('shared financial summary includes only completed POS sales plus approved OS quotes',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  await ws.openCashSession({openingCents:0});
  const sale=await ws.createSale({paymentMethod:'PIX',items:[
   {kind:'OUTRO',description:'Acessório',quantity:1,unitPriceCents:700}
  ],requestId:'sale-summary-001'});
  assert.equal(sale.total_cents,700);
  const summary=await ws.financeSummary();
  assert.equal(summary.invoicedCents,700);
  assert.equal(summary.receivedCents,700);
  assert.equal(summary.pendingCents,0);
 }finally{db.close();}
});
