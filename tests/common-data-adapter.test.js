import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('one async adapter contract runs on existing SQLite production schema and preserves local tables',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const adapter=createCommonDataAdapter({engine:'sqlite',db});
  assert.equal(adapter.engine,'sqlite');
  const workshop=createAsyncWorkshopServices(adapter);
  const client=await workshop.createCustomer({name:'Cliente local'});
  const machine=await workshop.createMachine({customerId:client.id,type:'AUTOMOVEL'});
  const os=await workshop.createWorkOrder({customerId:client.id,machineId:machine.id,problemReported:'Revisão'});
  assert.equal(os.status,'ENTRADA');
  const state=await workshop.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
  assert.equal(state.status,'DIAGNOSTICO');
  const quote=await workshop.saveQuote({workOrderId:os.id,
   items:[{kind:'PECA',description:'Filtro',quantity:2,unitPriceCents:1100}]});
  assert.equal(quote.total_cents,2200);
  const approved=await workshop.approveQuote({workOrderId:os.id});
  assert.equal(approved.approval_status,'APROVADO');
  const payment=await workshop.receivePayment({workOrderId:os.id,amountCents:1000,method:'PIX',requestId:'sqlite-adapter-pay'});
  const replay=await workshop.receivePayment({workOrderId:os.id,amountCents:1000,method:'PIX',requestId:'sqlite-adapter-pay'});
  assert.equal(payment.id,replay.id);
  assert.equal((await workshop.financeSummary()).pendingCents,1200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM receipts').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM work_orders').get().n,1);
 }finally{db.close();}
});
test('SQLite adapter batch is atomic, rolls back on failure, serializes concurrent transactions',async()=>{
 const db=openDatabase(':memory:');
 try{
  const port=createCommonDataAdapter({engine:'sqlite',db});
  await port.run('CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');
  await port.batch([{sql:'INSERT INTO events(id,name) VALUES(?,?)',params:[1,'first']}]);
  await assert.rejects(port.batch([
   {sql:'INSERT INTO events(id,name) VALUES(?,?)',params:[2,'second']},
   {sql:'INSERT INTO events(id,name) VALUES(?,?)',params:[3,'first']}
  ]),/UNIQUE/);
  assert.equal((await port.all('SELECT id FROM events')).length,1);
  const nums=await Promise.all(Array.from({length:10},(_,i)=>port.transaction(async tx=>{
   await tx.run('INSERT INTO events(id,name) VALUES(?,?)',[i+2,'item'+i]);
   return (await tx.first('SELECT name FROM events WHERE id=?',[i+2])).name;
  })));
  assert.equal(nums.length,10);
  assert.equal((await port.all('SELECT id FROM events')).length,11);
  await assert.rejects(port.transaction(async tx=>{
   await tx.run("INSERT INTO events(id,name) VALUES(20,'rolled_back')");
   throw new Error('abort');
  }),/abort/);
  assert.equal(await port.first("SELECT * FROM events WHERE name='rolled_back'"),null);
 }finally{db.close();}
});
test('adapter factory refuses unconfigured engines instead of silently falling back to SQLite',()=>{
 assert.throws(()=>createCommonDataAdapter({engine:'postgres'}),/PostgreSQL|pool/);
 assert.throws(()=>createCommonDataAdapter({engine:'d1'}),/D1|binding/);
 assert.throws(()=>createCommonDataAdapter({engine:'auto'}),/Engine|suportado/);
});
