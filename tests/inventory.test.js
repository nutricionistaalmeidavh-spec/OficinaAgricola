import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder } from '../src/services/work-orders.js';
import { saveQuote, approveQuote } from '../src/services/quotes.js';
import { createPart, addInventoryMovement, consumePart, reverseWorkOrderPart, lowStockParts, getPart } from '../src/services/inventory.js';

function setup(){
 const db=openDatabase(':memory:'); migrate(db);
 const c=createCustomer(db,{name:'Fazenda'}); const m=createMachine(db,{customerId:c.id,type:'Trator'});
 const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Falha'}); transitionWorkOrder(db,os.id,'DIAGNOSTICO');
 saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:1000}]}); approveQuote(db,os.id);
 const p=createPart(db,{sku:'FILTRO-01',description:'Filtro hidráulico',salePriceCents:5000,minStock:2});
 return {db,os,p};
}

test('records stock entry and manual exit as auditable movements',()=>{
 const {db,p}=setup(); addInventoryMovement(db,p.id,{type:'ENTRADA',quantity:5,note:'Compra'}); addInventoryMovement(db,p.id,{type:'SAIDA_MANUAL',quantity:1,note:'Uso balcão'});
 assert.equal(getPart(db,p.id).quantity,4); assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE part_id=?').get(p.id).n,2); db.close();
});

test('consumes stock on approved OS and reverses without deleting history',()=>{
 const {db,p,os}=setup(); addInventoryMovement(db,p.id,{type:'ENTRADA',quantity:3});
 const item=consumePart(db,os.id,p.id,{quantity:2}); assert.equal(getPart(db,p.id).quantity,1);
 reverseWorkOrderPart(db,item.id,{note:'Peça não utilizada'}); assert.equal(getPart(db,p.id).quantity,3);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE part_id=?').get(p.id).n,3); db.close();
});

test('blocks negative stock unless explicit admin override',()=>{
 const {db,p,os}=setup(); addInventoryMovement(db,p.id,{type:'ENTRADA',quantity:1});
 assert.throws(()=>consumePart(db,os.id,p.id,{quantity:2,userRole:'TECNICO'}),/Estoque insuficiente/);
 const item=consumePart(db,os.id,p.id,{quantity:2,userRole:'ADMIN',allowNegative:true}); assert.ok(item.id); assert.equal(getPart(db,p.id).quantity,-1); db.close();
});

test('lists parts below minimum stock',()=>{
 const {db,p}=setup(); addInventoryMovement(db,p.id,{type:'ENTRADA',quantity:1}); const low=lowStockParts(db); assert.equal(low.some(x=>x.id===p.id),true); db.close();
});
