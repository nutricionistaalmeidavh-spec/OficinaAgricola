import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {migrateTenantRegistry} from '../src/platform/tenant-registry.js';
import {createBackup,verifyBackup} from '../src/platform/backup.js';
import {runMultiTenantBackupCycle} from '../src/platform/tenant-backup.js';

test('multiempresa backup stamps source company/unit and never reuses an unlabeled legacy archive',t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-stamped-backup-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const legacyPath=join(root,'legacy.sqlite'),registryPath=join(root,'registry.sqlite');
 const tenantsRoot=join(root,'tenants'),backupRoot=join(root,'backups');
 const legacy=openDatabase(legacyPath),registry=openDatabase(registryPath);
 t.after(()=>{try{legacy.close();}catch{}try{registry.close();}catch{}});
 migrate(legacy);migrateAssistencia(legacy);migrateTenantRegistry(registry,legacy);
 registry.prepare('INSERT INTO tenant_units(company_id,code,name,created_at) VALUES(1,?,?,?)')
  .run('FILIAL','Filial','2026-11-04T13:00:00.000Z');
 const folder=join(tenantsRoot,'company-1','unit-2');
 mkdirSync(folder,{recursive:true});
 const second=openDatabase(join(folder,'oficina.sqlite'));migrate(second);migrateAssistencia(second);second.close();
 const now=new Date('2026-11-04T13:00:00.000Z');
 // A pre-existing unlabeled unit backup must NOT be reused after upgrade.
 const stale=createBackup({databasePath:legacyPath,uploadsPath:null,
  backupRoot:join(backupRoot,'company-1','unit-1'),now}).backupDir;
 assert.equal(verifyBackup(stale).tenant,undefined);
 const records=runMultiTenantBackupCycle({
  registryDb:registry,registryPath,legacyDatabasePath:legacyPath,
  legacyStorageDir:join(root,'uploads'),tenantsRoot,backupRoot,
  now:new Date('2026-11-04T13:01:00.000Z')
 });
 assert.equal(records.length,3);
 const registryArchive=records.find(x=>x.kind==='registry');
 assert.ok(registryArchive?.verified);
 const unitRecords=records.filter(x=>x.kind==='unit');
 assert.equal(unitRecords.length,2);
 for(const [index,record] of unitRecords.entries()){
  assert.equal(record.created,true);
  assert.deepEqual(verifyBackup(record.backupDir).tenant,{companyId:1,unitId:index+1});
 }
 const again=runMultiTenantBackupCycle({
  registryDb:registry,registryPath,legacyDatabasePath:legacyPath,
  legacyStorageDir:join(root,'uploads'),tenantsRoot,backupRoot,
  now:new Date('2026-11-04T13:02:00.000Z')
 });
 assert.equal(again.filter(x=>x.kind==='unit').every(x=>x.created===false),true);
});
