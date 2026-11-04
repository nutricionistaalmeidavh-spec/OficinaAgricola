import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackup} from '../src/platform/backup.js';
import {verifyTenantRecoverySet} from '../src/platform/tenant-recovery-set.js';

test('offline disaster-recovery preflight checks registry plus every tenant and never changes live files',t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-recovery-set-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const date=new Date('2026-11-04T13:00:00.000Z');
 const registryDb=join(root,'registry.sqlite');
 const reg=new DatabaseSync(registryDb);
 reg.exec('CREATE TABLE tenant_units(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL)');
 reg.exec('INSERT INTO tenant_units VALUES(1,1),(2,1),(3,2)');
 reg.close();
 const registryArchive=createBackup({databasePath:registryDb,uploadsPath:null,backupRoot:join(root,'registry'),now:date}).backupDir;
 const units=[1,2,3].map(id=>{
  const databasePath=join(root,'unit-'+id+'.sqlite'),db=new DatabaseSync(databasePath);
  db.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY,description TEXT)');
  db.prepare('INSERT INTO fixture VALUES(?,?)').run(id,'Tenant '+id);
  db.close();
  return {companyId:id===3?2:1,unitId:id,archivePath:createBackup({
   databasePath,uploadsPath:null,backupRoot:join(root,'archives',String(id)),now:date
  }).backupDir};
 });
 const plan=verifyTenantRecoverySet({registryArchive,unitArchives:units});
 assert.equal(plan.unitCount,3);
 assert.equal(plan.status,'verified-staging-only');
 assert.equal(plan.liveDataModified,false);
 assert.equal(plan.requiresStoppedService,true);
 assert.throws(()=>verifyTenantRecoverySet({registryArchive,unitArchives:units.slice(0,2)}),/ausente/);
 assert.throws(()=>verifyTenantRecoverySet({registryArchive,unitArchives:[units[0],{...units[1],companyId:2},units[2]]}),/empresa/);
});
