import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createBackup, verifyBackup, restoreBackup} from '../src/platform/backup.js';
import {runVerifiedBackupCycle} from '../src/platform/backup-scheduler.js';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'oficina-proof-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const databasePath=join(root,'data.sqlite'),uploadsPath=join(root,'uploads'),backupRoot=join(root,'backups');
  mkdirSync(uploadsPath,{recursive:true});
  const db=new DatabaseSync(databasePath);
  db.exec('CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers(name) VALUES (\'Cliente de teste\')');
  db.close();
  return {root,databasePath,uploadsPath,backupRoot};
}

test('P0 - um backup recente adulterado nunca é anunciado como verificado', t=>{
 const f=fixture(t);
 const first=runVerifiedBackupCycle({...f,now:new Date('2026-11-03T12:00:00Z')});
 writeFileSync(join(first.backupDir,'database.sqlite'),'corrompido');
 const next=runVerifiedBackupCycle({...f,now:new Date('2026-11-03T12:01:00Z')});
 assert.equal(next.created,true);
 assert.equal(next.verified,true);
 assert.notEqual(next.backupDir,first.backupDir);
});

test('P0 - manifesto sem database.sqlite nunca é aceito para restaurar',t=>{
 const f=fixture(t),b=createBackup(f);
 const path=join(b.backupDir,'manifest.json');
 const manifest=JSON.parse(readFileSync(path,'utf8'));
 manifest.files=manifest.files.filter(x=>x.path!=='database.sqlite');
 writeFileSync(path,JSON.stringify(manifest));
 assert.throws(()=>verifyBackup(b.backupDir),/backup|banco|manifesto/i);
 const dest=join(f.root,'do-not-overwrite.sqlite');
 writeFileSync(dest,'protegido');
 assert.throws(()=>restoreBackup({backupDir:b.backupDir,databasePath:dest,uploadsPath:join(f.root,'restored-uploads')}),/backup|banco|manifesto/i);
 assert.equal(readFileSync(dest,'utf8'),'protegido');
});

test('P0 - manifesto não pode apontar para symlinks fora do backup',t=>{
 const f=fixture(t),b=createBackup(f);
 const outside=join(f.root,'private.txt');
 writeFileSync(outside,'segredo externo');
 const link=join(b.backupDir,'uploads','external.txt');
 symlinkSync(outside,link);
 const path=join(b.backupDir,'manifest.json'),manifest=JSON.parse(readFileSync(path,'utf8'));
 manifest.files.push({path:'uploads/external.txt',size:15,sha256:createHash('sha256').update('segredo externo').digest('hex')});
 writeFileSync(path,JSON.stringify(manifest));
 assert.throws(()=>verifyBackup(b.backupDir),/backup|manifesto|simbólico/i);
});
