import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsyncWorkshopHandler} from '../src/platform/async-workshop-handler.js';

test('native attachment endpoint accepts a 2MiB image while unrelated JSON endpoints stay limited to 1MiB',async()=>{
 let saved=0;
 const token='s'.repeat(40),bytes=Buffer.alloc(2*1024*1024,3);
 const handler=createAsyncWorkshopHandler({serviceToken:token,services:{
  async saveAttachment(osId,body){saved++;assert.equal(osId,17);
   assert.equal(Buffer.from(body.base64,'base64').length,bytes.length);
   return {id:2,work_order_id:osId};
  },
  async createCustomer(){return{id:5};}
 }});
 const data={category:'ENTRADA',mimeType:'image/png',originalName:'foto.png',
  base64:bytes.toString('base64'),requestId:'test-large-attachment'};
 const headers={authorization:'Bearer '+token,'content-type':'application/json'};
 const attachment=await handler(new Request('http://localhost/v1/orders/17/attachments',{
  method:'POST',headers,body:JSON.stringify(data)
 }));
 assert.equal(attachment.status,201);
 assert.equal(saved,1);
 const ordinary=await handler(new Request('http://localhost/v1/customers',{
  method:'POST',headers,body:JSON.stringify(data)
 }));
 assert.equal(ordinary.status,413,'large arbitrary JSON requests must remain limited');
});
