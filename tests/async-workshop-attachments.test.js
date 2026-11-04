import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('common adapter uploads remote attachments with immutable scoped key and idempotent metadata',async()=>{
 const db=openDatabase(':memory:'),objects=new Map(),deleted=[];
 try{
  migrate(db);migrateAssistencia(db);
  const objectStore={
   async putObject({key,data}){objects.set(key,Buffer.from(data));},
   async getObject({key}){return objects.get(key);},
   async deleteObject({key}){deleted.push(key);objects.delete(key);}
  };
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}),{objectStore});
  const c=await ws.createCustomer({name:'Cliente'});
  const m=await ws.createMachine({customerId:c.id,type:'TRATOR'});
  const order=await ws.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Falha'});
  const payload={category:'DIAGNOSTICO',caption:'Foto',mimeType:'image/png',
   originalName:'foto.png',base64:Buffer.from('PNGTEST').toString('base64'),
   requestId:'upload-sql-common'};
  const row=await ws.saveAttachment(order.id,payload);
  assert.equal(row.relative_path.startsWith('s3:'+order.id+'/'),true);
  assert.equal((await ws.saveAttachment(order.id,payload)).id,row.id);
  assert.equal(objects.size,1);
  assert.equal((await ws.listAttachments(order.id)).length,1);
  assert.equal((await ws.getAttachment(row.id)).id,row.id);
  assert.equal(Buffer.from(await ws.readAttachment(row.id)).toString(),'PNGTEST');
  await assert.rejects(ws.saveAttachment(order.id,{...payload,base64:Buffer.from('other').toString('base64')}),/Identificador/);
  assert.equal(deleted.length,0);
 }finally{db.close();}
});
test('common remote attachments reject unsafe mime, excessive bytes and missing store without local fallback',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await ws.createCustomer({name:'Cliente'});
  const m=await ws.createMachine({customerId:c.id,type:'TRATOR'});
  const os=await ws.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Falha'});
  await assert.rejects(ws.saveAttachment(os.id,{mimeType:'image/png',base64:'AAAA',category:'ENTRADA'}),/Armazenamento/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attachments').get().n,0);
 }finally{db.close();}
});
