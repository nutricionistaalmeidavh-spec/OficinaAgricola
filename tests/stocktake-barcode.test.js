import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
import {migrateInventoryProcurement} from '../src/platform/inventory-procurement-schema.js';
import {migrateStocktakeBarcode} from '../src/platform/inventory-stocktake-schema.js';

async function setup(){
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 const now=new Date().toISOString();
 db.prepare('INSERT INTO users(id,username,password_hash,name,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  .run(11,'test-inventario','x','Administrador QA','ADMIN',now,now);
 const port=createCommonDataAdapter({engine:'sqlite',db});
 await migrateInventoryProcurement(port);await migrateStocktakeBarcode(port);
 return {db,service:createAsyncWorkshopServices(port)};
}
test('GTIN válido resolve peça exatamente, normaliza e recusa duplicação e dígito inválido',async()=>{
 const {db,service}=await setup();
 try{
  const part=await service.createPart({sku:'EAN-TESTE',description:'Peça de teste',barcode:'5901234123457'});
  assert.equal(part.barcode,'5901234123457');
  assert.equal((await service.findPartByBarcode('5901234123457')).id,part.id);
  assert.equal((await service.listPartsPage({search:'5901234123457'})).items.length,1);
  await assert.rejects(service.createPart({sku:'EAN-DUP',description:'Duplicada',barcode:'5901234123457'}),/UNIQUE|duplicado/i);
  await assert.rejects(service.createPart({sku:'EAN-INVALIDO',description:'Dígito inválido',barcode:'5901234123458'}),/GTIN/i);
  assert.equal((await service.updatePart(part.id,{barcode:''})).barcode,null);
  assert.equal(await service.findPartByBarcode('5901234123457'),null);
 }finally{db.close();}
});
test('inventário separa contagem da aplicação, registra diferenças e não duplica ajustes',async()=>{
 const {db,service}=await setup();
 try{
  const part=await service.createPart({sku:'CONT-01',description:'Filtro',barcode:'5901234123457'});
  await service.postStockMovement({partId:part.id,type:'ENTRADA',quantity:10,actorId:11});
  const stocktake=await service.createStocktake({name:'Contagem inicial',actorId:11,partIds:[part.id]});
  assert.equal(stocktake.lines[0].expected_quantity,10);
  await service.saveStocktakeCounts({stocktakeId:stocktake.id,counts:[{partId:part.id,quantity:7}],actorId:11});
  const prepared=await service.getStocktake(stocktake.id);
  assert.equal(prepared.lines[0].difference,-3);
  assert.equal((await service.getPart(part.id)).quantity,10,'contagem não deve alterar saldo');
  await assert.rejects(service.applyStocktake({stocktakeId:stocktake.id,actorId:11,actorRole:'ATENDIMENTO',reason:'Contagem revisada'}),/administrador/i);
  const applied=await service.applyStocktake({stocktakeId:stocktake.id,actorId:11,actorRole:'ADMIN',reason:'Contagem revisada'});
  assert.equal(applied.status,'APLICADO');
  assert.equal((await service.getPart(part.id)).quantity,7);
  const same=await service.applyStocktake({stocktakeId:stocktake.id,actorId:11,actorRole:'ADMIN',reason:'Contagem revisada'});
  assert.equal(same.id,applied.id);
  const history=await service.listStockMovements({partId:part.id,type:'AJUSTE'});
  assert.equal(history.items.length,1);
  assert.equal(history.items[0].source_type,'STOCKTAKE_LINE');
  assert.equal(Number(history.items[0].created_by),11);
  assert.equal((await service.reconcileStock(part.id)).difference,0);
 }finally{db.close();}
});
test('mudança de saldo após contagem impede aplicar fotografia obsoleta',async()=>{
 const {db,service}=await setup();
 try{
  const part=await service.createPart({sku:'CONT-02',description:'Rolamento'});
  await service.postStockMovement({partId:part.id,type:'ENTRADA',quantity:5});
  const take=await service.createStocktake({name:'Inventário',actorId:11,partIds:[part.id]});
  await service.saveStocktakeCounts({stocktakeId:take.id,actorId:11,counts:[{partId:part.id,quantity:4}]});
  await service.postStockMovement({partId:part.id,type:'SAIDA_MANUAL',quantity:1});
  await assert.rejects(service.applyStocktake({stocktakeId:take.id,actorId:11,actorRole:'ADMIN',reason:'Contagem física'}),/saldo alterado|obsoleta|recontagem/i);
  assert.equal((await service.getPart(part.id)).quantity,4);
  assert.equal((await service.getStocktake(take.id)).status,'ABERTO');
  assert.equal((await service.listStockMovements({type:'AJUSTE'})).items.length,0);
 }finally{db.close();}
});
test('inventário exige contagem de todas as peças e não admite estoque negativo',async()=>{
 const {db,service}=await setup();
 try{
  const a=await service.createPart({sku:'A1',description:'A'});
  const b=await service.createPart({sku:'B1',description:'B'});
  const take=await service.createStocktake({name:'Contagem',actorId:11,partIds:[a.id,b.id]});
  await service.saveStocktakeCounts({stocktakeId:take.id,actorId:11,counts:[{partId:a.id,quantity:0}]});
  await assert.rejects(service.applyStocktake({stocktakeId:take.id,actorId:11,actorRole:'ADMIN',reason:'Contagem final'}),/pendente|incomplet/i);
  await assert.rejects(service.saveStocktakeCounts({stocktakeId:take.id,actorId:11,counts:[{partId:b.id,quantity:-1}]}),/Quantidade inválida/i);
  await service.saveStocktakeCounts({stocktakeId:take.id,actorId:11,counts:[{partId:b.id,quantity:0}]});
  await service.applyStocktake({stocktakeId:take.id,actorId:11,actorRole:'ADMIN',reason:'Contagem final'});
  assert.equal((await service.getStocktake(take.id)).status,'APLICADO');
 }finally{db.close();}
});
