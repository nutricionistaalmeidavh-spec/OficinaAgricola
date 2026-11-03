import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer} from '../src/services/catalog.js';
import {runVerifiedBackupCycle} from '../src/platform/backup-scheduler.js';

test('P0 backup local é restaurável, versionado, verifica integridade e respeita retenção',()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-backup-hardening-'));
 const databasePath=join(root,'data','oficina.sqlite'),uploadsPath=join(root,'uploads'),backupRoot=join(root,'backups');
 try{
   const db=openDatabase(databasePath);migrate(db);
   createCustomer(db,{name:'Registro que precisa sobreviver'});
   db.close();
   const first=runVerifiedBackupCycle({databasePath,uploadsPath,backupRoot,now:new Date('2026-11-03T12:00:00Z'),retention:2,minIntervalMs:0});
   assert.equal(first.created,true);
   assert.equal(existsSync(join(first.backupDir,'database.sqlite')),true);
   assert.equal(first.verified,true);
   assert.equal(runVerifiedBackupCycle({databasePath,uploadsPath,backupRoot,now:new Date('2026-11-03T12:10:00Z'),retention:2}).created,false);
   const second=runVerifiedBackupCycle({databasePath,uploadsPath,backupRoot,now:new Date('2026-11-04T12:30:00Z'),retention:2});
   const third=runVerifiedBackupCycle({databasePath,uploadsPath,backupRoot,now:new Date('2026-11-05T13:00:00Z'),retention:2});
   assert.equal(second.created,true);assert.equal(third.created,true);
   assert.equal(readdirSync(backupRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).length,2);
   assert.equal(existsSync(first.backupDir),false);
 }finally{rmSync(root,{recursive:true,force:true})}
});
