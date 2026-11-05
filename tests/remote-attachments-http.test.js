import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder} from '../src/services/work-orders.js';
import {createAppServer} from '../src/server.js';

test('HTTP attachment routes read/write from configured primary object store and enforce user auth',async t=>{
  const db=openDatabase(':memory:');migrate(db);
  createUser(db,{username:'admin',name:'Admin',role:'ADMIN',password:'StrongP@ss2026'});
  const customer=createCustomer(db,{name:'Cliente'});
  const machine=createMachine(db,{customerId:customer.id,type:'AUTOMOVEL'});
  const order=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Falha'});
  const objects=new Map(),calls=[];
  const objectStore={
    async putObject({key,data}){objects.set(key,Buffer.from(data));calls.push('put');return {key};},
    async getObject({key}){calls.push('get');return objects.get(key);},
    async deleteObject({key}){objects.delete(key);calls.push('delete');}
  };
  const server=createAppServer({db,objectStore});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(method,path,body,token)=>{
    const r=await fetch(base+path,{method,headers:{
      ...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json'}:{})
    },body:body?JSON.stringify(body):undefined});
    return {status:r.status,contentType:r.headers.get('content-type'),data:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};
  };
  const login=await request('POST','/api/auth/login',{username:'admin',password:'StrongP@ss2026'});
  assert.equal(login.status,200);
  const token=login.data.token;
  const payload={category:'DIAGNOSTICO',mimeType:'application/pdf',originalName:'laudo.pdf',
    base64:Buffer.from('%PDF-1.4 test').toString('base64'),requestId:'http-remote-001'};
  const save=await request('POST','/api/work-orders/'+order.id+'/attachments',payload,token);
  assert.equal(save.status,200,JSON.stringify(save.data));
  assert.equal(save.data.relative_path.startsWith('s3:'),true);
  assert.equal(objects.size,1);
  const denied=await request('GET','/api/attachments/'+save.data.id+'/file');
  assert.equal(denied.status,401);
  const download=await request('GET','/api/attachments/'+save.data.id+'/file',undefined,token);
  assert.equal(download.status,200);
  assert.equal(download.contentType,'application/pdf');
  assert.deepEqual(download.data,Buffer.from('%PDF-1.4 test'));
  const replay=await request('POST','/api/work-orders/'+order.id+'/attachments',payload,token);
  assert.equal(replay.status,200);
  assert.equal(replay.data.id,save.data.id);
  assert.deepEqual(calls,['put','get']);
});
