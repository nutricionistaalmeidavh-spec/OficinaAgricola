import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createS3BackupClient} from '../src/platform/s3-backup.js';

test('S3 remote recovery streams 6 MB without tiny attachment limit; rejects tampered checksums and cleans incomplete files',async t=>{
 const data=Buffer.alloc(6*1024*1024,0x3d);
 const hash=createHash('sha256').update(data).digest('hex');
 const server=createServer((req,res)=>{
  if(!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')){
   res.writeHead(403);res.end();return;
  }
  if(req.method==='GET'){
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':String(data.length),
    'x-amz-meta-sha256':hash});
   res.end(data);return;
  }
  res.writeHead(405);res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const root=mkdtempSync(join(tmpdir(),'oficina-s3-stream-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const client=createS3BackupClient({endpoint:'http://127.0.0.1:'+server.address().port,
  bucket:'backups-archive',region:'us-east-1',prefix:'registry',
  accessKeyId:'local',secretAccessKey:'local-secret'});
 const path=join(root,'database.sqlite');
 const result=await client.downloadObject({key:'2026-11-03/database.sqlite',filePath:path,
  expectedSize:data.length,expectedSha256:hash});
 assert.equal(result.size,data.length);
 assert.deepEqual(readFileSync(path),data);
 await assert.rejects(client.downloadObject({key:'2026-11-03/database.sqlite',
  filePath:join(root,'tampered.sqlite'),expectedSize:data.length,
  expectedSha256:'0'.repeat(64)}),/integridade|SHA-256/i);
 assert.equal(existsSync(join(root,'tampered.sqlite')),false);
});
