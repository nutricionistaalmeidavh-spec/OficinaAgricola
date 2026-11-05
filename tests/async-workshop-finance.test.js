import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('shared expense ledger preserves paid expense through edit and aggregates exactly once',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const service=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const expense=await service.createExpense({description:'Energia',category:'Fixa',
   amountCents:4000,paidAt:'2026-11-04T11:00:00.000Z',
   requestId:'expense-common-001'});
  assert.equal(expense.amount_cents,4000);
  const same=await service.createExpense({description:'Energia',category:'Fixa',
   amountCents:4000,paidAt:'2026-11-04T11:00:00.000Z',
   requestId:'expense-common-001'});
  assert.equal(same.id,expense.id);
  assert.equal((await service.listExpenses()).length,1);
  const updated=await service.updateExpense(expense.id,{amountCents:3900,note:'Desconto'});
  assert.equal(updated.amount_cents,3900);
  assert.equal((await service.financeSummary()).expensesCents,3900);
  await assert.rejects(service.createExpense({description:'Outra despesa',
   amountCents:500,requestId:'expense-common-001'}),/Identificador/);
 }finally{db.close();}
});
test('shared OS receipt reversal preserves original financial row and posts single canonical refund',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const service=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const customer=await service.createCustomer({name:'Cliente'});
  const machine=await service.createMachine({customerId:customer.id,type:'AUTOMOVEL'});
  const os=await service.createWorkOrder({customerId:customer.id,machineId:machine.id,
   problemReported:'Reparo'});
  await service.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
  await service.saveQuote({workOrderId:os.id,
   items:[{kind:'MAO_DE_OBRA',description:'Reparo',quantity:1,unitPriceCents:3000}]});
  await service.approveQuote({workOrderId:os.id});
  const receipt=await service.receivePayment({workOrderId:os.id,amountCents:1000,
   method:'PIX',requestId:'shared-receipt-reversal'});
  const reversed=await service.reverseReceipt({workOrderId:os.id,receiptId:receipt.id,
   note:'Devolução'});
  assert.ok(reversed.reversed_at);
  assert.equal((await service.listReceipts(os.id)).length,1);
  const summary=await service.getPaymentSummary(os.id);
  assert.equal(summary.receivedCents,0);
  assert.equal(summary.pendingCents,3000);
  assert.equal((await service.financeSummary()).receivedCents,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,2);
  await assert.rejects(service.reverseReceipt({workOrderId:os.id,receiptId:receipt.id}),/estornado/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,2);
 }finally{db.close();}
});
