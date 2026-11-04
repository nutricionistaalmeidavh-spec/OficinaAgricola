import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder} from '../src/services/work-orders.js';
import {saveRemoteAttachment,readRemoteAttachment} from '../src/platform/remote-attachments.js';

const init=()=>{
 const db=openDatabase(':memory:');migrate(db);
 const customer=createCustomer(db,{name:'Cliente Remoto'});
 const machine=createMachine(db,{customerId:customer.id,type:'AUTOMOVEL'});
 const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Inspeção'});
 const objects=new Map(),uploads=[],deletions=[];
 const objectStore={
   async putObject({key,data,mimeType}){uploads.push(key);objects.set(key,Buffer.from(data));return {key,hash:'stub',size:data.length};},
   async getObject({key}){const b=objects.get(key);if(!b)throw Error('Not found');return b;},
   async deleteObject({key}){deletions.push(key);objects.delete(key);}
 };
 return {db,os,objectStore,objects,uploads,deletions,close:()=>db.close()};
};
const payload={category:'ENTRADA',mimeType:'image/png',originalName:'foto.png',caption:'Entrada',base64:Buffer.from('imagem').toString('base64'),requestId:'remote-file-001'};
test('remote attachment is primary: stored in S3 without local filesystem path, and replay does not duplicate',async()=>{
 const s=init();
 try{
  const first=await saveRemoteAttachment(s.db,s.os.id,payload,{objectStore:s.objectStore});
  assert.equal(first.relative_path.startsWith('s3:'),true);
  assert.equal(s.uploads.length,1);
  assert.deepEqual(await readRemoteAttachment(first,s.objectStore),Buffer.from('imagem'));
  const second=await saveRemoteAttachment(s.db,s.os.id,payload,{objectStore:s.objectStore});
  assert.equal(second.id,first.id);
  assert.equal(s.uploads.length,1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM attachments').get().n,1);
  await assert.rejects(saveRemoteAttachment(s.db,s.os.id,{...payload,caption:'outro'},{objectStore:s.objectStore}),/Identificador/);
 }finally{s.close();}
});
test('remote attachment never leaves unlinked object after SQLite insertion failure',async()=>{
 const s=init();
 try{
  s.db.exec("CREATE TRIGGER reject_upload BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'blocked'); END");
  await assert.rejects(saveRemoteAttachment(s.db,s.os.id,payload,{objectStore:s.objectStore}),/blocked/);
  assert.equal(s.objects.size,0);
  assert.equal(s.deletions.length,1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM attachments').get().n,0);
 }finally{s.close();}
});
test('remote attachment validates type and maximum 5 MB before uploading',async()=>{
 const s=init();
 try{
  await assert.rejects(saveRemoteAttachment(s.db,s.os.id,{...payload,mimeType:'application/x-executable'},{objectStore:s.objectStore}),/Tipo/);
  await assert.rejects(saveRemoteAttachment(s.db,s.os.id,{...payload,base64:Buffer.alloc(5*1024*1024+1).toString('base64')},{objectStore:s.objectStore}),/excede/);
  assert.equal(s.uploads.length,0);
 }finally{s.close();}
});

test('simultaneous uploads with same request ID keep one canonical row and one remote object',async()=>{
 const s=init();
 try{
  const [a,b]=await Promise.all([
    saveRemoteAttachment(s.db,s.os.id,payload,{objectStore:s.objectStore}),
    saveRemoteAttachment(s.db,s.os.id,payload,{objectStore:s.objectStore})
  ]);
  assert.equal(a.id,b.id);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM attachments').get().n,1);
  assert.equal(s.objects.size,1,'second temporary upload is cleaned after losing idempotency race');
 }finally{s.close();}
});

test('S3 upload returning error after PUT still cleans the remote key before aborting SQLite',async()=>{
 const s=init();
 try{
  const failing={
    ...s.objectStore,
    async putObject({key,data}){
      s.objects.set(key,Buffer.from(data));
      throw Error('S3 HEAD did not confirm integrity');
    }
  };
  await assert.rejects(saveRemoteAttachment(s.db,s.os.id,payload,{objectStore:failing}),/S3 HEAD/);
  assert.equal(s.objects.size,0,'orphan must be removed even if upload throws after PUT');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM attachments').get().n,0);
 }finally{s.close();}
});
