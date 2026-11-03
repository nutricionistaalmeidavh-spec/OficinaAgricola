import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer} from '../src/services/catalog.js';
import {backupAndVerify,verifyBackup} from '../src/platform/backup.js';

test('P0 backup: checkpoint SQLite/WAL + uploads are restored and tested before retention',()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-p0-backup-'));
 const dbPath=join(root,'data','oficina.sqlite'),upload=join(root,'uploads'),backup=join(root,'backups');
 mkdirSync(upload,{recursive:true});const db=openDatabase(dbPath);migrate(db);
 try{
  createCustomer(db,{name:'Recuperação P0'});
  writeFileSync(join(upload,'sample.txt'),'arquivo de teste');
  for(let i=0;i<3;i++){
   const result=backupAndVerify({databasePath:dbPath,uploadsPath:upload,backupRoot:backup,keep:2});
   assert.equal(result.verified,true);
   assert.equal(verifyBackup(result.backupDir).files.length>=2,true);
  }
  const dirs=readdirSync(backup).filter(x=>!x.startsWith('.'));
  assert.equal(dirs.length,2);
  assert.equal(backupAndVerify({databasePath:dbPath,uploadsPath:upload,backupRoot:backup,keep:2}).verified,true);
 }finally{db.close();rmSync(root,{recursive:true,force:true})}
});
