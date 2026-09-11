import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, createMachine, createTechnician } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder, updateWorkOrder, getWorkOrder, machineHistory } from '../src/services/work-orders.js';

function setup(){
  const db=openDatabase(':memory:'); migrate(db);
  const c=createCustomer(db,{name:'Agro Forte'});
  const m=createMachine(db,{customerId:c.id,type:'Trator',brand:'Case',model:'Puma 200'});
  const t=createTechnician(db,{name:'João'});
  return {db,c,m,t};
}

test('creates sequential work orders with customer and machine snapshots',()=>{
  const {db,c,m}=setup();
  const a=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Vazamento hidráulico'});
  const b=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Ruído no eixo'});
  assert.equal(a.os_number,1); assert.equal(b.os_number,2);
  assert.match(a.snapshot_customer,/Agro Forte/); assert.match(a.snapshot_machine,/Puma 200/);
  db.close();
});

test('rejects a work order when machine does not belong to customer',()=>{
  const {db,m}=setup(); const other=createCustomer(db,{name:'Outro'});
  assert.throws(()=>createWorkOrder(db,{customerId:other.id,machineId:m.id,problemReported:'Falha'}),/não pertence/);
  db.close();
});

test('records auditable status transitions and blocks invalid jumps',()=>{
  const {db,c,m,t}=setup(); const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Falha'});
  updateWorkOrder(db,os.id,{diagnosis:'Bomba com vedação danificada',technicianId:t.id});
  transitionWorkOrder(db,os.id,'DIAGNOSTICO',{changedBy:null});
  assert.throws(()=>transitionWorkOrder(db,os.id,'EM_SERVICO'),/Transição inválida/);
  const history=db.prepare('SELECT * FROM work_order_status_history WHERE work_order_id=? ORDER BY id').all(os.id);
  assert.equal(history.length,2); // creation + diagnosis
  assert.equal(history.at(-1).to_status,'DIAGNOSTICO');
  db.close();
});

test('machine history returns work orders newest first',()=>{
  const {db,c,m}=setup(); createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Primeira'}); createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Segunda'});
  const h=machineHistory(db,m.id); assert.equal(h.length,2); assert.equal(h[0].problem_reported,'Segunda');
  db.close();
});
