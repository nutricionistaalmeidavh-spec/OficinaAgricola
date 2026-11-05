import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
import {migrateInventoryProcurement} from '../src/platform/inventory-procurement-schema.js';

async function setup(){
 const db=openDatabase(':memory:');
 migrate(db);migrateAssistencia(db);
 const now=new Date().toISOString();
 for(const id of [11,17])
  db.prepare('INSERT INTO users(id,username,password_hash,name,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .run(id,'test-usuario-'+id,'teste-sem-login','Operador QA '+id,'ADMIN',now,now);
 const port=createCommonDataAdapter({engine:'sqlite',db});
 await migrateInventoryProcurement(port);
 const service=createAsyncWorkshopServices(port);
 return {db,service};
}
test('ajuste assinado exige administrador, motivo e grava autor/saldo no livro canônico',async()=>{
 const {db,service}=await setup();
 try{
  const part=await service.createPart({sku:'AJ-01',description:'Rolamento',minStock:2});
  await service.postStockMovement({partId:part.id,type:'ENTRADA',quantity:5,actorId:11});
  await assert.rejects(service.postStockMovement({partId:part.id,type:'AJUSTE',quantity:-2,note:'Contagem fisica',actorRole:'ATENDIMENTO',actorId:11}),/administrador/i);
  await assert.rejects(service.postStockMovement({partId:part.id,type:'AJUSTE',quantity:-2,note:'',actorRole:'ADMIN',actorId:11}),/motivo/i);
  await assert.rejects(service.postStockMovement({partId:part.id,type:'AJUSTE',quantity:-6,note:'Contagem fisica',actorRole:'ADMIN',actorId:11}),/Estoque insuficiente/);
  const adjusted=await service.postStockMovement({partId:part.id,type:'AJUSTE',quantity:-2,note:'Contagem física',actorRole:'ADMIN',actorId:11});
  assert.equal(adjusted.quantityDelta,-2);
  assert.equal((await service.getPart(part.id)).quantity,3);
  const movements=await service.listStockMovements({partId:part.id,type:'AJUSTE'});
  assert.equal(movements.items.length,1);
  assert.equal(movements.items[0].quantity_delta,-2);
  assert.equal(Number(movements.items[0].created_by),11);
  assert.equal(movements.items[0].note,'Contagem física');
  assert.equal((await service.reconcileStock(part.id)).difference,0);
 }finally{db.close()}
});

test('fornecedor, pedido e recebimentos parciais são atômicos, idempotentes e auditáveis',async()=>{
 const {db,service}=await setup();
 try{
  const supplier=await service.createSupplier({name:'Peças do Bairro',document:'123'});
  const part=await service.createPart({sku:'COM-02',description:'Filtro'});
  const order=await service.createPurchaseOrder({supplierId:supplier.id,reference:'PED-1',
   items:[{partId:part.id,quantity:10,costCents:2000}],actorId:17});
  assert.equal((await service.getPart(part.id)).quantity,0);
  const detailed=await service.getPurchaseOrder(order.id);
  assert.equal(detailed.items.length,1);
  const itemId=detailed.items[0].id;
  const payload={orderId:order.id,requestId:'receber-001',items:[{itemId,quantity:4}],note:'Entrega parcial',actorId:17};
  const first=await service.receivePurchaseOrder(payload);
  const replay=await service.receivePurchaseOrder(payload);
  assert.equal(replay.id,first.id);
  assert.equal((await service.getPart(part.id)).quantity,4);
  assert.equal((await service.getPurchaseOrder(order.id)).status,'PARCIAL');
  await assert.rejects(service.receivePurchaseOrder({...payload,requestId:'receber-002',
   items:[{itemId,quantity:7}]}),/pendente|excede/i);
  await assert.rejects(service.receivePurchaseOrder({...payload,items:[{itemId,quantity:5}]}),/identificador|diferente/i);
  assert.equal((await service.getPart(part.id)).quantity,4);
  await service.receivePurchaseOrder({...payload,requestId:'receber-003',items:[{itemId,quantity:6}]});
  assert.equal((await service.getPurchaseOrder(order.id)).status,'RECEBIDO');
  assert.equal((await service.getPart(part.id)).quantity,10);
  assert.equal((await service.reconcileStock(part.id)).difference,0);
  const history=await service.listStockMovements({type:'ENTRADA',search:'COM-02'});
  assert.equal(history.items.length,2);
  assert.ok(history.items.every(x=>x.source_type==='PURCHASE_RECEIPT_LINE'));
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM purchase_receipts").get().n),2);
  assert.equal((await service.listSuppliers({search:'Bairro'})).length,1);
  assert.equal((await service.listPurchaseOrders()).length,1);
 }finally{db.close()}
});
