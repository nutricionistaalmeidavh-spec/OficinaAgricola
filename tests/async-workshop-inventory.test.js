import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('common inventory consumes OS part only after approval and safely reverses the same canonical ledger',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const customer=await ws.createCustomer({name:'Cliente'});
  const machine=await ws.createMachine({customerId:customer.id,type:'TRATOR'});
  const os=await ws.createWorkOrder({customerId:customer.id,machineId:machine.id,problemReported:'Motor'});
  const part=await ws.createPart({sku:'SKU-OS',description:'Junta',salePriceCents:2500,
   minStock:2});
  await ws.postStockMovement({partId:part.id,type:'ENTRADA',quantity:4});
  await assert.rejects(ws.consumePart({workOrderId:os.id,partId:part.id,quantity:1}),
   /aprovada|serviço/i);
  await ws.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
  await ws.saveQuote({workOrderId:os.id,
   items:[{kind:'PECA',description:'Junta',quantity:1,unitPriceCents:2500}]});
  await ws.approveQuote({workOrderId:os.id});
  const used=await ws.consumePart({workOrderId:os.id,partId:part.id,quantity:3,
   requestId:'consumo-001'});
  const replay=await ws.consumePart({workOrderId:os.id,partId:part.id,quantity:3,
   requestId:'consumo-001'});
  assert.equal(used.id,replay.id);
  assert.equal((await ws.getPart(part.id)).quantity,1);
  assert.equal((await ws.listWorkOrderParts(os.id)).length,1);
  assert.equal((await ws.lowStockParts()).length,1);
  const stock=await ws.reconcileStock(part.id);assert.equal(stock.difference,0);
  const reversed=await ws.reverseWorkOrderPart({workOrderId:os.id,itemId:used.id,
   requestId:'estorno-001',note:'Devolução'});
  assert.ok(reversed.reversed_at);
  assert.equal((await ws.getPart(part.id)).quantity,4);
  assert.equal((await ws.reconcileStock(part.id)).difference,0);
  await assert.rejects(ws.reverseWorkOrderPart({workOrderId:os.id,itemId:used.id}),/estornado/i);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,3);
 }finally{db.close();}
});
test('common inventory listing and update do not mutate stock quantity directly',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const part=await ws.createPart({sku:'SKU-EDIT',description:'Filtro',salePriceCents:1000});
  const updated=await ws.updatePart(part.id,{description:'Filtro novo',salePriceCents:1200,quantity:500});
  assert.equal(updated.quantity,0);
  assert.equal(updated.sale_price_cents,1200);
  assert.equal((await ws.listParts({search:'Filtro novo'})).length,1);
  const page=await ws.listPartsPage({limit:1});assert.equal(page.total,1);
  assert.equal(page.items.length,1);
 }finally{db.close();}
});
