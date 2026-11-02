import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder, listWorkOrders } from '../src/services/work-orders.js';
import { dashboardData } from '../src/services/dashboard.js';

function fixture(){
  const db=openDatabase(':memory:'); migrate(db);
  const customer=createCustomer(db,{name:'Cliente QA P0'});
  const machine=createMachine(db,{customerId:customer.id,type:'Trator',brand:'Case',model:'QA'});
  const order=()=>createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Teste P0'});
  return {db,order};
}

test('P0: entregas do mês usam delivered_at e não updated_at ou entered_at',()=>{
  const {db,order}=fixture();
  try{
    const deliveredInMonth=order(), deliveredLastMonth=order(), editedAfterDelivery=order();
    db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at=?,updated_at=? WHERE id=?")
      .run('2026-11-02T10:00:00.000Z','2026-12-01T10:00:00.000Z',deliveredInMonth.id);
    db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at=?,updated_at=? WHERE id=?")
      .run('2026-10-31T23:59:59.000Z','2026-11-03T10:00:00.000Z',deliveredLastMonth.id);
    db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at=?,updated_at=? WHERE id=?")
      .run('2026-12-01T00:00:00.000Z','2026-11-02T10:00:00.000Z',editedAfterDelivery.id);
    assert.equal(dashboardData(db,{now:new Date('2026-11-15T12:00:00.000Z')}).counts.ENTREGUES_MES,1);
    assert.equal(dashboardData(db,{now:new Date('2026-10-15T12:00:00.000Z')}).counts.ENTREGUES_MES,1);
  }finally{db.close()}
});

test('P0: histórico de OS encerradas permite filtro e paginação, sem limite fixo de 200',()=>{
  const {db,order}=fixture();
  try{
    const ids=Array.from({length:205},()=>order().id);
    ids.forEach(id=>db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at='2026-11-02T10:00:00.000Z' WHERE id=?").run(id));
    const first=listWorkOrders(db,{scope:'closed',status:'ENTREGUE',limit:100,offset:0});
    const third=listWorkOrders(db,{scope:'closed',status:'ENTREGUE',limit:100,offset:200});
    assert.equal(first.length,100);
    assert.equal(third.length,5);
    assert.equal(first[0].id,ids.at(-1));
    assert.equal(third.at(-1).id,ids[0]);
    assert.equal(listWorkOrders(db,{scope:'active'}).length,0);
  }finally{db.close()}
});
