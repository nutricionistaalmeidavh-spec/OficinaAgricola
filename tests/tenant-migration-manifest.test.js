import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
import {buildCanonicalSqliteManifest,verifyCanonicalTargetManifest} from '../src/platform/tenant-migration-manifest.js';

test('explicit migration manifest fingerprints ALL canonical SQLite tables without mutating existing customer database',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const services=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const customer=await services.createCustomer({name:'Cliente no Windows'});
  const machine=await services.createMachine({customerId:customer.id,type:'AUTOMOVEL'});
  const workOrder=await services.createWorkOrder({
   customerId:customer.id,machineId:machine.id,problemReported:'Teste'}
  );
  const first=buildCanonicalSqliteManifest(db);
  const second=buildCanonicalSqliteManifest(db);
  assert.equal(first.digest,second.digest,'two read-only scans have identical digest');
  assert.equal(first.readyForRemote,true);
  assert.equal(first.tables.work_orders.count,1);
  assert.equal(first.tables.customers.count,1);
  assert.ok(Object.keys(first.tables).length>=46);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM work_orders').get().n,1);
  db.prepare('UPDATE work_orders SET problem_reported=? WHERE id=?')
    .run('Mudança deliberada',workOrder.id);
  const modified=buildCanonicalSqliteManifest(db);
  assert.notEqual(modified.digest,first.digest,
   'a modified historical record must be detected before cutover');
 }finally{db.close();}
});
test('target manifest verification is read only and refuses divergent canonical row content',async()=>{
 const source=openDatabase(':memory:');
 try{
  migrate(source);migrateAssistencia(source);
  const services=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db:source}));
  await services.createCustomer({name:'Cliente'});
  const snapshot=buildCanonicalSqliteManifest(source);
  const port=createCommonDataAdapter({engine:'sqlite',db:source});
  const matches=await verifyCanonicalTargetManifest(port,snapshot);
  assert.equal(matches.ok,true);
  source.prepare('UPDATE customers SET name=? WHERE name=?').run('Alterado','Cliente');
  const drift=await verifyCanonicalTargetManifest(port,snapshot);
  assert.equal(drift.ok,false);
  assert.ok(drift.differences.some(x=>x.table==='customers'));
 }finally{source.close();}
});
test('migration manifest refuses silent attachment loss when source still references local disk',()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const t=new Date().toISOString();
  db.prepare('INSERT INTO customers(name,created_at,updated_at) VALUES(?,?,?)').run('A',t,t);
  db.prepare('INSERT INTO machines(customer_id,type,created_at,updated_at) VALUES(1,?,?,?)')
   .run('AUTOMOVEL',t,t);
  db.prepare(`INSERT INTO work_orders(os_number,customer_id,machine_id,entered_at,
    problem_reported,snapshot_customer,snapshot_machine,created_at,updated_at)
    VALUES(1,1,1,?,'Problema','{}','{}',?,?)`).run(t,t,t);
  db.prepare(`INSERT INTO attachments(work_order_id,category,mime_type,
    original_name,relative_path,size_bytes,created_at)
    VALUES(1,'DIAGNOSTICO','image/png','foto.png','1/foto.png',100,?)`).run(t);
  const manifest=buildCanonicalSqliteManifest(db);
  assert.equal(manifest.readyForRemote,false);
  assert.equal(manifest.unresolvedDiskAttachments,1);
 }finally{db.close();}
});
