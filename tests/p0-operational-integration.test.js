import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder, listWorkOrders, listWorkOrdersPage } from '../src/services/work-orders.js';
import { dashboardData } from '../src/services/dashboard.js';
import { createPart } from '../src/services/inventory.js';

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
    const firstPage=listWorkOrdersPage(db,{scope:'closed',status:'ENTREGUE',limit:100});
    const secondPage=listWorkOrdersPage(db,{scope:'closed',status:'ENTREGUE',limit:100,cursor:firstPage.nextCursor});
    const lastPage=listWorkOrdersPage(db,{scope:'closed',status:'ENTREGUE',limit:100,cursor:secondPage.nextCursor});
    assert.equal(firstPage.total,205);
    assert.equal(firstPage.items.length,100);
    assert.equal(secondPage.items.length,100);
    assert.equal(lastPage.items.length,5);
    assert.equal(lastPage.nextCursor,null);
    assert.equal(listWorkOrdersPage(db,{scope:'active'}).total,0);
  }finally{db.close()}
});

test('P0: indicadores de estoque contam mais de oito itens abaixo do mínimo',()=>{
  const {db}=fixture();
  try{
    for(let i=0;i<13;i++)createPart(db,{sku:'P0-'+i,description:'Peça QA '+i,minStock:4});
    const dashboard=dashboardData(db,{now:new Date('2026-11-15T12:00:00.000Z')});
    assert.equal(dashboard.lowStock.length,13);
  }finally{db.close()}
});

test('P0: mês operacional segue o fuso local da oficina, não UTC',()=>{
  const previousTz=process.env.TZ;
  process.env.TZ='America/Sao_Paulo';
  const {db,order}=fixture();
  try{
    const octoberLocal=order(),novemberLocal=order();
    db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at=? WHERE id=?")
      .run('2026-11-01T02:30:00.000Z',octoberLocal.id);
    db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at=? WHERE id=?")
      .run('2026-11-01T03:30:00.000Z',novemberLocal.id);
    assert.equal(dashboardData(db,{now:new Date('2026-11-15T12:00:00.000Z')}).counts.ENTREGUES_MES,1);
  }finally{
    db.close();
    if(previousTz===undefined)delete process.env.TZ;else process.env.TZ=previousTz;
  }
});
