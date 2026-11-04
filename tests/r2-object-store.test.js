import test from 'node:test';
import assert from 'node:assert/strict';
import {createR2ObjectStoreAdapter} from '../src/platform/r2-object-store.js';

test('optional native R2 object store namespaces every key by trusted company/unit and verifies SHA-256',async()=>{
 const objects=new Map();
 const bucket={
  async put(key,bytes,options){objects.set(key,{
   bytes:Buffer.from(bytes),metadata:options.customMetadata
  });return {key};},
  async get(key){const row=objects.get(key);if(!row)return null;
   return {size:row.bytes.length,customMetadata:row.metadata,
    async arrayBuffer(){return Uint8Array.from(row.bytes).buffer;}};
  },
  async delete(key){objects.delete(key);}
 };
 const first=createR2ObjectStoreAdapter({bucket,companyId:3,unitId:5});
 const second=createR2ObjectStoreAdapter({bucket,companyId:3,unitId:6});
 await first.putObject({key:'1/a.png',data:Buffer.from('hello'),mimeType:'image/png'});
 assert.equal(objects.has('company-3/unit-5/1/a.png'),true);
 await assert.rejects(second.getObject({key:'1/a.png'}),/indisponível/);
 assert.equal(Buffer.from(await first.getObject({key:'1/a.png'})).toString(),'hello');
 objects.get('company-3/unit-5/1/a.png').bytes=Buffer.from('tampered');
 await assert.rejects(first.getObject({key:'1/a.png'}),/integridade/i);
 await first.deleteObject({key:'1/a.png'});
 assert.equal(objects.size,0);
});
