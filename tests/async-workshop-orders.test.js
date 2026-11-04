import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('common work-order service edits with version history and filters terminal transfer status',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await ws.createCustomer({name:'Frota'});
  const vehicle=await ws.createMachine({customerId:c.id,type:'TRATOR',brand:'New Holland'});
  const os=await ws.createWorkOrder({customerId:c.id,machineId:vehicle.id,problemReported:'Falha'});
  assert.equal((await ws.listWorkOrders({scope:'active'})).length,1);
  assert.equal((await ws.listWorkOrdersPage({limit:10})).total,1);
  const changed=await ws.updateWorkOrder(os.id,{diagnosis:'Correia quebrada',expectedVersion:os.version});
  assert.equal(changed.diagnosis,'Correia quebrada');
  assert.equal(changed.version,os.version+1);
  await assert.rejects(ws.updateWorkOrder(os.id,{priority:'URGENTE',expectedVersion:os.version}),/versão/i);
  const history=await ws.getWorkOrderHistory(os.id);
  assert.ok(history.some(x=>x.type==='FIELD_CHANGE'&&x.field==='diagnosis'));
  assert.equal((await ws.machineHistory(vehicle.id)).length,1);
  const copy=await ws.duplicateWorkOrder(os.id,{copyProblem:false});
  assert.equal(copy.status,'ENTRADA');
  assert.equal(copy.problem_reported,'Serviço a definir');
  assert.equal((await ws.listWorkOrders({scope:'active'})).length,2);
 }finally{db.close();}
});
test('canceling an OS must not silently cancel with active stock consumption or payments',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await ws.createCustomer({name:'Frota'});
  const m=await ws.createMachine({customerId:c.id,type:'TRATOR'});
  const order=await ws.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Reparo'});
  await ws.transitionWorkOrder({workOrderId:order.id,toStatus:'DIAGNOSTICO',expectedVersion:order.version});
  await ws.saveQuote({workOrderId:order.id,
   items:[{kind:'MAO_DE_OBRA',description:'Mão de obra',quantity:1,unitPriceCents:2500}]});
  await ws.approveQuote({workOrderId:order.id});
  const paid=await ws.receivePayment({workOrderId:order.id,amountCents:1000,method:'PIX',
   requestId:'cannot-cancel'});
  const current=await ws.getWorkOrder(order.id);
  await assert.rejects(ws.transitionWorkOrder({workOrderId:order.id,toStatus:'CANCELADA',
   expectedVersion:current.version}),/recebimentos/);
  assert.equal((await ws.getWorkOrder(order.id)).status,'APROVADA');
  await ws.reverseReceipt({workOrderId:order.id,receiptId:paid.id,note:'estorno'});
  const canceled=await ws.transitionWorkOrder({workOrderId:order.id,toStatus:'CANCELADA',
   expectedVersion:current.version});
  assert.equal(canceled.status,'CANCELADA');
 }finally{db.close();}
});
test('common quote workflow supports submit and reject with historic reason',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await ws.createCustomer({name:'Cliente'});
  const m=await ws.createMachine({customerId:c.id,type:'AUTOMOVEL'});
  const os=await ws.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Ruído'});
  await ws.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
  await ws.saveQuote({workOrderId:os.id,items:[
   {kind:'MAO_DE_OBRA',description:'Peça e serviço',quantity:1,unitPriceCents:1900}
  ]});
  const sent=await ws.submitQuote({workOrderId:os.id});
  assert.equal(sent.approval_status,'AGUARDANDO');
  const rejected=await ws.rejectQuote({workOrderId:os.id,reason:'Cliente preferiu adiar'});
  assert.equal(rejected.approval_status,'REPROVADO');
  assert.equal(rejected.rejection_reason,'Cliente preferiu adiar');
  assert.equal((await ws.getWorkOrder(os.id)).status,'REPROVADA');
  assert.equal((await ws.getQuote(os.id)).items.length,1);
 }finally{db.close();}
});
