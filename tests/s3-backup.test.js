import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../src/db.js';
import { createBackup } from '../src/platform/backup.js';
import { createS3BackupClient, mirrorVerifiedTenantBackups } from '../src/platform/s3-backup.js';

test('S3-compatible MinIO backup mirrors signed objects and verifies each remote SHA-256',async t=>{
  const objects=new Map(),headersSeen=[];
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks);
    headersSeen.push({method:req.method,path:req.url,authorization:req.headers.authorization,
      hash:req.headers['x-amz-content-sha256'],date:req.headers['x-amz-date'],length:req.headers['content-length']});
    if(req.method==='PUT'){
      const actual=createHash('sha256').update(raw).digest('hex');
      if(actual!==req.headers['x-amz-content-sha256']){res.writeHead(400);res.end();return;}
      objects.set(req.url,{raw,hash:actual});res.writeHead(200);res.end();return;
    }
    if(req.method==='HEAD'&&objects.has(req.url)){
      const item=objects.get(req.url);
      res.writeHead(200,{'x-amz-meta-sha256':item.hash,'content-length':String(item.raw.length)});
      res.end();return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>await new Promise(resolve=>server.close(resolve)));
  const root=mkdtempSync(join(tmpdir(),'oficina-s3-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const databasePath=join(root,'data.sqlite');
  const db=openDatabase(databasePath);migrate(db);db.close();
  const uploads=join(root,'uploads');mkdirSync(uploads);
  writeFileSync(join(uploads,'check.txt'),'backup verification');
  const backupRoot=join(root,'backups');
  const archive=createBackup({databasePath,uploadsPath:uploads,backupRoot:join(backupRoot,'registry')});
  const client=createS3BackupClient({
    endpoint:'http://127.0.0.1:'+server.address().port,bucket:'oficina-backups',
    region:'us-east-1',accessKeyId:'test-access',secretAccessKey:'test-secret',
    prefix:'artisys-tests'
  });
  const copied=await mirrorVerifiedTenantBackups({
    records:[{backupDir:archive.backupDir,created:true,verified:true}],
    backupRoot,client
  });
  assert.equal(copied.length,1);
  assert.ok(objects.size>=3,'database, attachment and manifest uploaded');
  const paths=[...objects.keys()];
  assert.ok(paths.some(path=>path.endsWith('/manifest.json')));
  assert.ok(paths.some(path=>path.endsWith('/database.sqlite')));
  assert.ok(paths.some(path=>path.endsWith('/uploads/check.txt')));
  assert.ok(headersSeen.every(x=>x.authorization?.startsWith('AWS4-HMAC-SHA256 ')&&x.date&&/^[a-f0-9]{64}$/.test(x.hash)));
  assert.ok(headersSeen.every(x=>!x.path.includes('test-secret')));
  assert.ok(headersSeen.filter(x=>x.method==='PUT').every(x=>Number.isSafeInteger(Number(x.length))),'S3 PUT must send a fixed Content-Length');
  const uploadedBefore=headersSeen.filter(x=>x.method==='PUT').length;
  const mirroredAgain=await mirrorVerifiedTenantBackups({
    records:[{backupDir:archive.backupDir,created:false,verified:true}],backupRoot,client
  });
  assert.equal(mirroredAgain.length,1);
  assert.equal(headersSeen.filter(x=>x.method==='PUT').length,uploadedBefore,
    'periodic backup checks should not re-upload identical objects');
});
test('S3 backups reject insecure public endpoints and missing credentials',()=>{
  const settings={bucket:'office',region:'us-east-1',accessKeyId:'x',secretAccessKey:'y'};
  assert.throws(()=>createS3BackupClient({...settings,endpoint:'http://example.org'}),/HTTPS/);
  assert.throws(()=>createS3BackupClient({...settings,endpoint:'https://example.org',secretAccessKey:''}),/credenciais/i);
  assert.throws(()=>createS3BackupClient({...settings,endpoint:'https://user:pass@example.org'}),/endpoint/i);
});

test('backup creation and S3 mirror reject symbolic links before external files can be uploaded',{skip:process.platform==='win32'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'oficina-s3-link-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dbPath=join(root,'db.sqlite');const db=openDatabase(dbPath);migrate(db);db.close();
  const uploads=join(root,'uploads');mkdirSync(uploads);
  const privateFile=join(root,'private-secret.txt');writeFileSync(privateFile,'do-not-exfiltrate');
  const sourceLink=join(uploads,'out-of-root.txt');
  symlinkSync(privateFile,sourceLink);
  const backupRoot=join(root,'backups'),registryRoot=join(backupRoot,'registry');
  // Hardened createBackup rejects a symlink before it can become an archive.
  assert.throws(()=>createBackup({databasePath:dbPath,uploadsPath:uploads,backupRoot:registryRoot}),/link simbólico|symlink/i);
  rmSync(sourceLink);
  writeFileSync(join(uploads,'normal.txt'),'safe');
  const archive=createBackup({databasePath:dbPath,uploadsPath:uploads,backupRoot:registryRoot});
  // Also reject a post-creation symlink tampering attempt during mirroring.
  symlinkSync(privateFile,join(archive.backupDir,'uploads','out-of-root.txt'));
  const writes=[];
  const client={async putFile(arg){writes.push(arg.key);}};
  await assert.rejects(()=>mirrorVerifiedTenantBackups({
    records:[{backupDir:archive.backupDir,created:true,verified:true}],backupRoot,client
  }),/link simbólico|symlink|arquivos não verificados/i);
  assert.equal(writes.length,0,'remote mirror must upload nothing from tampered archive');
});
