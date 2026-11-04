import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
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

test('read-only operator CLI produces sanitized digest without altering local SQLite file',()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-migration-manifest-'));
 const path=join(root,'oficina.sqlite'),db=openDatabase(path);
 try{
  migrate(db);migrateAssistencia(db);db.close();
  const prior=statSync(path).size;
  const cmd=spawnSync(process.execPath,[
   'scripts/inspect-tenant-migration.mjs','--file',path
  ],{encoding:'utf8',timeout:15000});
  assert.equal(cmd.status,0,cmd.stderr);
  const snapshot=JSON.parse(cmd.stdout);
  assert.equal(snapshot.format,'artisys-workshop-canonical-v1');
  assert.ok(snapshot.digest.length===64);
  assert.equal(snapshot.readyForRemote,true);
  assert.equal(statSync(path).size,prior,'manifest scan must not write WAL or expand data file');
  const refused=spawnSync(process.execPath,['scripts/inspect-tenant-migration.mjs'],
   {encoding:'utf8'});
  assert.notEqual(refused.status,0,'no implicit default customer path');
 }finally{try{db.close();}catch{}rmSync(root,{recursive:true,force:true});}
});

test('manifest recognizes runtime remote-upload idempotency table used by existing local installations',()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  db.exec(`CREATE TABLE tenant_remote_upload_requests(
   work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
   request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,
   attachment_id INTEGER NOT NULL REFERENCES attachments(id),
   PRIMARY KEY(work_order_id,request_id)
  )`);
  const manifest=buildCanonicalSqliteManifest(db);
  assert.ok(manifest.tables.tenant_remote_upload_requests,
   'runtime tables must be exported, not dropped or treated as unknown');
 }finally{db.close();}
});
