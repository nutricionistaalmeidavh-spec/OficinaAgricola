import {performance} from 'node:perf_hooks';
import {openDatabase,migrate,transaction} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {listCustomersPage,listMachinesPage} from '../src/services/catalog.js';
import {listPartsPage} from '../src/services/inventory.js';
import {listWorkOrdersPage} from '../src/services/work-orders.js';
import {listSalesPage} from '../src/services/sales.js';
import {listExpensesPage,financeSummary} from '../src/services/finance.js';
import {listSchedulePage} from '../src/services/operations.js';

const size=Number(process.argv.find(x=>/^--size=/.test(x))?.split('=')[1]||1000);
if(![1000,10000,100000].includes(size))throw new Error('Use --size=1000, 10000 ou 100000');
const started=performance.now();
const db=openDatabase(':memory:');
try{
 migrate(db);migrateAssistencia(db);
 const stamp='2026-11-03T12:00:00.000Z';
 const count=Math.max(1,Math.ceil(size/10));
 transaction(db,()=>{
  const c=db.prepare("INSERT INTO customers(name,created_at,updated_at) VALUES(?,?,?)");
  const m=db.prepare("INSERT INTO machines(customer_id,type,brand,model,created_at,updated_at) VALUES(?,'CARRO','Marca','Modelo',?,?)");
  for(let i=1;i<=count;i++){c.run('Cliente '+i,stamp,stamp);m.run(i,stamp,stamp);}
  const part=db.prepare("INSERT INTO parts(sku,description,quantity,min_stock,created_at,updated_at) VALUES(?,?,5,1,?,?)");
  for(let i=1;i<=count;i++)part.run('SKU-'+i,'Peça '+i,stamp,stamp);
  const os=db.prepare("INSERT INTO work_orders(os_number,customer_id,machine_id,entered_at,problem_reported,status,snapshot_customer,snapshot_machine,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  const sale=db.prepare("INSERT INTO sales(sale_number,subtotal_cents,total_cents,payment_method,created_at) VALUES(?,100,100,'PIX',?)");
  const expense=db.prepare("INSERT INTO expenses(description,amount_cents,due_date,created_at,updated_at) VALUES('Custo',100,'2026-11-03',?,?)");
  const schedule=db.prepare("INSERT INTO schedule_events(type,title,starts_at,created_at,updated_at) VALUES('VISITA','Revisão',?,?,?)");
  for(let i=1;i<=size;i++){
   const customer=(i%count)+1;
   os.run(i,customer,customer,stamp,'Problema '+i,i%3===0?'ENTREGUE':'ENTRADA','{}','{}',stamp,stamp);
   if(i%2===0){sale.run(i,stamp);expense.run(stamp,stamp);schedule.run(stamp,stamp,stamp);}
  }
 });
 const queries={
  customers:()=>listCustomersPage(db,{limit:50}),
  machines:()=>listMachinesPage(db,{limit:50}),
  parts:()=>listPartsPage(db,{limit:50}),
  workOrders:()=>listWorkOrdersPage(db,{limit:50}),
  workOrdersFiltered:()=>listWorkOrdersPage(db,{status:'ENTRADA',limit:50}),
  sales:()=>listSalesPage(db,{limit:50}),
  expenses:()=>listExpensesPage(db,{limit:50}),
  schedule:()=>listSchedulePage(db,{limit:50}),
  finance:()=>financeSummary(db,{from:'2026-11-01T00:00:00.000Z',to:'2026-11-30T23:59:59.999Z'})
 };
 const metrics={};
 for(const [name,fn] of Object.entries(queries)){
  const times=[];
  for(let i=0;i<12;i++){const start=performance.now();fn();times.push(performance.now()-start);}
  times.shift();times.sort((a,b)=>a-b);
  metrics[name]={p50Ms:Number(times[Math.floor(times.length*0.5)].toFixed(3)),p95Ms:Number(times[Math.floor(times.length*0.95)].toFixed(3))};
 }
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT id FROM work_orders WHERE status='ENTRADA' ORDER BY id DESC LIMIT 50").all().map(x=>x.detail);
 const health=db.prepare('PRAGMA quick_check').get();
 const pageCount=db.prepare('PRAGMA page_count').get().page_count;
 const pageSize=db.prepare('PRAGMA page_size').get().page_size;
 console.log(JSON.stringify({size,seedMs:Math.round(performance.now()-started),metrics,workOrdersPlan:plan,
   approxDbBytes:pageCount*pageSize,quickCheck:health.quick_check},null,2));
 if(health.quick_check!=='ok')process.exitCode=1;
}finally{db.close();}
