import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createS3BackupClient} from '../src/platform/s3-backup.js';
const sha=raw=>createHash('sha256').update(raw).digest('hex');

test('native S3 object store uploads and retrieves attachment bytes with signed scoped requests',async t=>{
 const files=new Map(),ops=[];
 const server=createServer(async(req,res)=>{
   const parts=[];for await(const chunk of req)parts.push(chunk);
   const bytes=Buffer.concat(parts),key=req.url;
   ops.push({method:req.method,key,auth:req.headers.authorization});
   if(!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')){res.writeHead(403);res.end();return;}
   if(req.method==='PUT'){
     files.set(key,{bytes,hash:sha(bytes)});
     res.writeHead(200);res.end();return;
   }
   const item=files.get(key);
   if(!item){res.writeHead(404);res.end();return;}
   if(req.method==='HEAD'){res.writeHead(200,{'content-length':item.bytes.length,'x-amz-meta-sha256':item.hash});res.end();return;}
   if(req.method==='GET'){res.writeHead(200,{'content-length':item.bytes.length,'x-amz-meta-sha256':item.hash});res.end(item.bytes);return;}
   if(req.method==='DELETE'){files.delete(key);res.writeHead(204);res.end();return;}
   res.writeHead(405);res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const client=createS3BackupClient({endpoint:'http://127.0.0.1:'+server.address().port,
  bucket:'oficina-objects',region:'us-east-1',prefix:'company-2/unit-4',
  accessKeyId:'local-test',secretAccessKey:'local-secret'});
 const content=Buffer.from('evidencia pdf');
 await client.putObject({key:'17/file.pdf',data:content,mimeType:'application/pdf'});
 assert.deepEqual(await client.getObject({key:'17/file.pdf',maxBytes:200}),content);
 await assert.rejects(client.getObject({key:'17/file.pdf',maxBytes:3}),/limite/);
 await client.deleteObject({key:'17/file.pdf'});
 assert.equal(files.size,0);
 assert.ok(ops.every(x=>x.key.startsWith('/oficina-objects/company-2/unit-4/')));
 assert.ok(ops.every(x=>x.auth?.includes('SignedHeaders=')));
});
