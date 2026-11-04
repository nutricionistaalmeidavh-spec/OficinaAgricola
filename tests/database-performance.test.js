import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {listCustomersPage,listMachinesPage} from '../src/services/catalog.js';
import {listPartsPage} from '../src/services/inventory.js';
import {listSalesPage} from '../src/services/sales.js';
import {listExpensesPage} from '../src/services/finance.js';
import {listFiscalDocumentsPage} from '../src/services/fiscal.js';
import {listSchedulePage} from '../src/services/operations.js';
import {cleanupOperationalData} from '../src/platform/data-maintenance.js';
import {dispatchOutbox,unpublishedOutbox} from '../src/platform/outbox.js';

function fixture(){
  const db=openDatabase(':memory:');
  migrate(db);migrateAssistencia(db);
  return db;
}

test('P0: paginação estável, filtros e limites de clientes, veículos e peças',()=>{
  const db=fixture();
  try{
    const insertCustomer=db.prepare("INSERT INTO customers(name,document,phone,email,address,notes,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)");
    for(let i=0;i<125;i++)insertCustomer.run('Cliente '+String(i%7).padStart(2,'0'),'','','','','','2026-11-03','2026-11-03');
    const customers=[],seen=new Set();let cursor=null;
    do{
      const page=listCustomersPage(db,{limit:23,cursor});
      assert.ok(page.items.length<=23);
      assert.equal(page.total,125);
      for(const row of page.items){assert.ok(!seen.has(row.id));seen.add(row.id);customers.push(row);}
      cursor=page.nextCursor;
    }while(cursor);
    assert.equal(customers.length,125);
    assert.deepEqual(customers.map(x=>x.id).slice().sort((a,b)=>a-b).length,125);
    assert.throws(()=>listCustomersPage(db,{cursor:'bad!!!'}),/Cursor/);
    const c=customers[0];
    for(let i=0;i<82;i++)db.prepare("INSERT INTO machines(customer_id,type,brand,model,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(c.id,'CARRO','Marca','Modelo '+i,'2026-11-03','2026-11-03');
    const machines=listMachinesPage(db,{customerId:c.id,limit:10});
    assert.equal(machines.total,82);
    assert.equal(machines.items.length,10);
    for(let i=0;i<73;i++)db.prepare("INSERT INTO parts(sku,description,created_at,updated_at) VALUES(?,?,?,?)")
      .run('SK'+i,'Peça '+(i%5),'2026-11-03','2026-11-03');
    const p=listPartsPage(db,{limit:13});
    assert.equal(p.total,73);
    assert.equal(p.items.length,13);
  }finally{db.close();}
});

test('P0: vendas, despesas, documentos e agenda têm páginas e limite máximo',()=>{
  const db=fixture();
  try{
    for(let i=0;i<105;i++){
      db.prepare("INSERT INTO sales(sale_number,subtotal_cents,total_cents,payment_method,created_at) VALUES(?,?,?,?,?)")
       .run(i+1,100,100,'PIX','2026-11-03');
      db.prepare("INSERT INTO expenses(description,amount_cents,created_at,updated_at) VALUES(?,?,?,?)")
       .run('Despesa '+i,100,'2026-11-03','2026-11-03');
      db.prepare("INSERT INTO schedule_events(type,title,starts_at,created_at,updated_at) VALUES('VISITA',?,?,?,?)")
       .run('Evento '+i,'2026-11-04','2026-11-03','2026-11-03');
      db.prepare("INSERT INTO fiscal_documents(kind,origin_type,origin_id,amount_cents,snapshot_json,snapshot_hash,request_id,created_at,updated_at) VALUES('NFE','SALE',?,?,?,'abc',?,?,?)")
       .run(i+1,100,'{}','doc-'+i,'2026-11-03','2026-11-03');
    }
    for(const page of [
      listSalesPage(db,{limit:7}),listExpensesPage(db,{limit:7}),
      listFiscalDocumentsPage(db,{limit:7}),listSchedulePage(db,{limit:7})
    ]){assert.equal(page.total,105);assert.equal(page.items.length,7);assert.ok(page.nextCursor);}
    assert.equal(listSalesPage(db,{limit:100000}).items.length,100);
    assert.equal(typeof listFiscalDocumentsPage(db,{limit:1}).items[0].snapshot_json,'string');
  }finally{db.close();}
});

test('P2: migração versionada e expurgo seguro conservam lançamentos financeiros',()=>{
  const db=fixture();
  try{
    const count=()=>Number(db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n);
    assert.equal(count(),2);
    migrate(db);migrateAssistencia(db);
    assert.equal(count(),2);
    db.prepare("INSERT INTO users(username,password_hash,name,role,created_at,updated_at) VALUES('qa','hash','QA','ADMIN','2020','2020')").run();
    db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES('old',1,'2020','2020')").run();
    db.prepare("INSERT INTO command_idempotency(scope,request_id,payload_hash,result_json,created_at) VALUES('pay','safe','hash','{}','2020')").run();
    const removed=cleanupOperationalData(db,{now:'2026-11-03T00:00:00.000Z'});
    assert.equal(removed.sessions,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM command_idempotency").get().n,1);
  }finally{db.close();}
});

test('P2: falha de entrega não prende o restante da outbox',async()=>{
  const db=fixture();
  try{
    for(let i=1;i<=3;i++)db.prepare("INSERT INTO domain_outbox(event_key,event_id,event_type,payload_json,meta_json,created_at) VALUES(?,?,?,?,?,?)")
      .run('k'+i,'e'+i,'ENTITY_MUTATED',JSON.stringify({method:'POST',path:'/api/example',resourceId:i}),'{}','2026-11-03');
    const sent=[];
    await dispatchOutbox(db,{deliver:async e=>{if(e.payload.resourceId===1)throw Error('Falha temporária');sent.push(e.payload.resourceId);}},2);
    assert.deepEqual(sent,[2,3]);
    assert.equal(unpublishedOutbox(db).length,1);
    assert.equal(unpublishedOutbox(db,100,{dueOnly:true}).length,0);
    assert.equal(db.prepare("SELECT attempts FROM domain_outbox WHERE event_key='k1'").get().attempts,1);
  }finally{db.close();}
});
