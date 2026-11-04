import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../src/db.js';
import { createBackup, verifyBackup } from '../src/platform/backup.js';
import { mirrorVerifiedTenantBackups } from '../src/platform/s3-backup.js';
import { restoreMirroredTenantBackup } from '../src/platform/tenant-remote-restore.js';

const sha=data=>createHash('sha256').update(data).digest('hex');

test('stages signed remote backup as independently verified archive without changing live tenant DB',async t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-remote-restore-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const databasePath=join(root,'live.sqlite');
 const db=openDatabase(databasePath);migrate(db);
 db.prepare('UPDATE company_settings SET name=? WHERE id=1').run('Live company');db.close();
 const uploads=join(root,'uploads');mkdirSync(uploads);
 writeFileSync(join(uploads,'receipt.pdf'),'%PDF original receipt');
 const backupRoot=join(root,'backups');
 const backup=createBackup({databasePath,uploadsPath:uploads,backupRoot:join(backupRoot,'registry')});
 const data=new Map();
 const client={
  async putFile({filePath,key}){data.set(key,readFileSync(filePath));return {key};},
  async getObject({key,maxBytes}){
   if(!data.has(key))throw Error('Remote object not found');
   const raw=data.get(key);
   if(raw.length>maxBytes)throw Error('Remote file limit exceeded');
   return raw;
  }
 };
 const mirrored=await mirrorVerifiedTenantBackups({
   records:[{backupDir:backup.backupDir,verified:true}],backupRoot,client
 });
 assert.equal(mirrored.length,1);
 const restoreRoot=join(root,'staging');
 const result=await restoreMirroredTenantBackup({client,remoteArchive:mirrored[0].archive,restoreRoot});
 assert.ok(result.archivePath.startsWith(restoreRoot));
 assert.equal(result.manifest.files.length,backup.manifest.files.length);
 verifyBackup(result.archivePath);
 assert.deepEqual(readFileSync(join(result.archivePath,'uploads','receipt.pdf')),Buffer.from('%PDF original receipt'));
 assert.ok(existsSync(databasePath));
 const original=openDatabase(databasePath);
 assert.equal(original.prepare('SELECT name FROM company_settings WHERE id=1').get().name,'Live company');
 original.close();
 assert.notEqual(result.archivePath,backup.backupDir);
});

test('remote restoration blocks path traversal before file writes and removes corrupt staging',async t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-remote-untrusted-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const content=Buffer.from('exfil');
 const manifest={version:1,createdAt:new Date().toISOString(),files:[
  {path:'../outside.txt',size:content.length,sha256:sha(content)}
 ]};
 const objects=new Map([
  ['registry/malicious/manifest.json',Buffer.from(JSON.stringify(manifest))],
  ['registry/malicious/../outside.txt',content]
 ]);
 const client={async getObject({key}){if(!objects.has(key))throw Error('Not found');return objects.get(key);}};
 await assert.rejects(restoreMirroredTenantBackup({client,remoteArchive:'registry/malicious',restoreRoot:join(root,'restore')}),/caminho|path|manifesto/i);
 assert.equal(existsSync(join(root,'outside.txt')),false);
 assert.equal(existsSync(join(root,'restore')),true);
 assert.equal((await import('node:fs')).readdirSync(join(root,'restore')).length,0);
});

test('remote restore rejects corrupted bytes and leaves no apparently valid staged backup',async t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-remote-corrupt-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const expected=Buffer.from('valid');
 const manifest={version:1,createdAt:new Date().toISOString(),files:[
  {path:'database.sqlite',size:expected.length,sha256:sha(expected)}
 ]};
 const files=new Map([
  ['registry/corrupt/manifest.json',Buffer.from(JSON.stringify(manifest))],
  ['registry/corrupt/database.sqlite',Buffer.from('wrong')]
 ]);
 const client={async getObject({key}){return files.get(key);}};
 await assert.rejects(restoreMirroredTenantBackup({
   client,remoteArchive:'registry/corrupt',restoreRoot:join(root,'staging')
 }),/integridade|SHA-256/i);
 assert.equal((await import('node:fs')).readdirSync(join(root,'staging')).length,0);
});
