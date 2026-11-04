import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createD1Port} from '../src/platform/async-sql-ports.js';
import {migrateAsyncTenantStore,assertAsyncTenantIdentity} from '../src/platform/async-tenant-migrations.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
import {importCanonicalSqliteTenant} from '../src/platform/tenant-migration-import.js';
import {markLegacyRegistryLink} from '../src/platform/tenant-registry.js';

function testD1(db){
 const binding={
  prepare(sql){return {bind(...args){return {
   async first(){return db.prepare(sql).get(...args);},
   async all(){return {results:db.prepare(sql).all(...args)};},
   async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}
  }}}},
  async batch(commands){db.exec('BEGIN IMMEDIATE');try{
   const out=[];for(const query of commands)out.push(await query.run());
   db.exec('COMMIT');return out;
  }catch(error){db.exec('ROLLBACK');throw error;}}
 };
 return createD1Port({binding});
}
test('opt-in SQLite-to-D1 import migrates every table, verifies hashes, and claims tenant only after success',async()=>{
 const source=openDatabase(':memory:'),target=openDatabase(':memory:');
 try{
  migrate(source);migrateAssistencia(source);markLegacyRegistryLink(source);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db:source}));
  const customer=await ws.createCustomer({name:'Cliente antigo'});
  const machine=await ws.createMachine({customerId:customer.id,type:'AUTOMOVEL',
   brand:'Fiat',model:'Uno'});
  const order=await ws.createWorkOrder({customerId:customer.id,machineId:machine.id,
   problemReported:'Histórico completo'});
  // Older SQLite releases added unit_id as a nullable column. Do not
  // rewrite a historical NULL into another company/branch while importing.
  source.prepare('UPDATE work_orders SET unit_id=NULL WHERE id=?').run(order.id);
  const part=await ws.createPart({sku:'OLD-PART-001',description:'Filtro'});
  await ws.postStockMovement({partId:part.id,type:'ENTRADA',quantity:4});
  const port=testD1(target);
  await migrateAsyncTenantStore(port,{seed:false});
  const result=await importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
   companyId:22,unitId:7});
  assert.equal(result.verified,true);
  assert.equal(result.identity.companyId,22);
  assert.equal(result.identity.unitId,7);
  assert.equal((await port.first('SELECT COUNT(*) n FROM work_orders')).n,1);
  assert.equal((await port.first('SELECT COUNT(*) n FROM inventory_movements')).n,1);
  assert.equal((await port.first('SELECT * FROM work_orders WHERE id=?',[order.id])).problem_reported,
   'Histórico completo');
  assert.equal((await port.first('SELECT unit_id FROM work_orders WHERE id=?',
   [order.id])).unit_id,null,'historical NULL unit must be preserved byte-for-byte');
  assert.deepEqual(await assertAsyncTenantIdentity(port,{companyId:22,unitId:7}),
   {companyId:22,unitId:7});
  assert.equal(source.prepare('SELECT COUNT(*) n FROM work_orders').get().n,1);
  await assert.rejects(importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
   companyId:22,unitId:7}),/destino|não está vazio|inicializado/);
 }finally{source.close();target.close();}
});
test('staging import refuses local attachment metadata without moving bytes and leaves identity unclaimed',async()=>{
 const source=openDatabase(':memory:'),target=openDatabase(':memory:');
 try{
  migrate(source);migrateAssistencia(source);
  const at=new Date().toISOString();
  source.prepare('INSERT INTO customers(name,created_at,updated_at) VALUES(?,?,?)').run('X',at,at);
  source.prepare('INSERT INTO machines(customer_id,type,created_at,updated_at) VALUES(1,?,?,?)')
   .run('AUTOMOVEL',at,at);
  source.prepare(`INSERT INTO work_orders(os_number,customer_id,machine_id,entered_at,
    problem_reported,snapshot_customer,snapshot_machine,created_at,updated_at)
    VALUES(1,1,1,?,'OS','{}','{}',?,?)`).run(at,at,at);
  source.prepare(`INSERT INTO attachments(work_order_id,category,mime_type,
    original_name,relative_path,size_bytes,created_at)
    VALUES(1,'DIAGNOSTICO','image/png','foto.png','1/foto.png',5,?)`).run(at);
  const port=testD1(target);
  await migrateAsyncTenantStore(port,{seed:false});
  await assert.rejects(importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
   companyId:22,unitId:7}),/anexo|disco/i);
  assert.equal((await port.first('SELECT COUNT(*) n FROM customers')).n,0);
  assert.equal(await port.first('SELECT * FROM async_tenant_identity'),null);
 }finally{source.close();target.close();}
});

test('staging import verifies actual R2/MinIO bytes, not only attachment metadata',async()=>{
 const source=openDatabase(':memory:'),target=openDatabase(':memory:');
 try{
  migrate(source);migrateAssistencia(source);
  const at=new Date().toISOString();
  source.prepare('INSERT INTO customers(name,created_at,updated_at) VALUES(?,?,?)')
   .run('X',at,at);
  source.prepare('INSERT INTO machines(customer_id,type,created_at,updated_at) VALUES(1,?,?,?)')
   .run('AUTOMOVEL',at,at);
  source.prepare(`INSERT INTO work_orders(os_number,customer_id,machine_id,entered_at,
    problem_reported,snapshot_customer,snapshot_machine,created_at,updated_at)
    VALUES(1,1,1,?,'OS','{}','{}',?,?)`).run(at,at,at);
  const key='1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
  source.prepare(`INSERT INTO attachments(work_order_id,category,mime_type,
    original_name,relative_path,size_bytes,created_at)
    VALUES(1,'DIAGNOSTICO','image/png','foto.png',?,5,?)`)
   .run('s3:'+key,at);
  const port=testD1(target);
  await migrateAsyncTenantStore(port,{seed:false});
  await assert.rejects(importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
   companyId:3,unitId:4}),/storage|anexos|objectStore/i);
  assert.equal(await port.first('SELECT * FROM async_tenant_identity'),null);
  const sourceStore={async getObject({key:received,maxBytes}){
    assert.equal(received,key);assert.ok(maxBytes>=5);return Buffer.from('12345');
  }};
  await assert.rejects(importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
    companyId:3,unitId:4,objectStore:sourceStore}),/storage|destino|anexo/i,
    'metadata points to destination storage, which must be separately verified');
  await assert.rejects(importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
    companyId:3,unitId:4,objectStore:sourceStore,
    targetObjectStore:{async getObject(){return Buffer.from('XXXXX');}}
  }),/integridade|divergente|checksum/i);
  assert.equal(await port.first('SELECT * FROM async_tenant_identity'),null);
  const transfer=await importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
    companyId:3,unitId:4,objectStore:sourceStore,targetObjectStore:sourceStore
  });
  assert.equal(transfer.verified,true);
  assert.equal((await port.first('SELECT * FROM attachments')).relative_path,'s3:'+key);
 }finally{source.close();target.close();}
});

test('empty target preflight also checks native-only runtime tables absent in older SQLite sources',async()=>{
 const source=openDatabase(':memory:'),target=openDatabase(':memory:');
 try{
  migrate(source);migrateAssistencia(source);
  const port=testD1(target);
  await migrateAsyncTenantStore(port,{seed:false});
  assert.equal(source.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='tenant_remote_upload_requests'").get().n,0);
  target.exec('PRAGMA foreign_keys=OFF');
  target.prepare(`INSERT INTO tenant_remote_upload_requests(
    work_order_id,request_id,payload_hash,attachment_id
  ) VALUES(999,'foreign-tenant','other-company',888)`).run();
  target.exec('PRAGMA foreign_keys=ON');
  await assert.rejects(importCanonicalSqliteTenant({sourceDb:source,targetPort:port,
   companyId:5,unitId:6}),/destino não está vazio|outro tenant/i);
  assert.equal(await port.first('SELECT * FROM async_tenant_identity'),null);
 }finally{source.close();target.close();}
});
