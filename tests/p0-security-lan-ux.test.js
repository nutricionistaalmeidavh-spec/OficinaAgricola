import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createUser} from '../src/auth.js';
import {createAssistenciaServer} from '../src/server-assistencia.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,getWorkOrder,updateWorkOrder} from '../src/services/work-orders.js';
import {createPart,addInventoryMovement,consumePart,reverseWorkOrderPart} from '../src/services/inventory.js';
import {dashboardData} from '../src/services/dashboard.js';
import {resolveServerConfig} from '../src/platform/network.js';
import {saveAttachment} from '../src/services/operations.js';

function fixture(){
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 const users=[
 ['ADMIN','admin'],['TECNICO','tecnico'],['ATENDIMENTO','atendimento'],['FINANCEIRO','financeiro']
 ];
 for(const [role,username] of users)createUser(db,{username,role,name:username,password:'SenhaTeste123!'});
 return db;
}
async function appFixture(t){
 const db=fixture(),app=createAssistenciaServer({db});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.close(r));db.close()});
 const url='http://127.0.0.1:'+app.address().port;
 async function login(username){
  const r=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'SenhaTeste123!'})});
  assert.equal(r.status,200);return (await r.json()).token;
 }
 async function send(path,token,{method='GET',body,headers={}}={}){
  const r=await fetch(url+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),headers:r.headers};
 }
 return {db,login,send};
}

test('P0: dashboard TECH/ATENDIMENTO cannot read financial data, ADMIN can',async t=>{
 const f=await appFixture(t),tech=await f.login('tecnico'),office=await f.login('atendimento'),admin=await f.login('admin');
 for(const token of [tech,office]){
  const r=await f.send('/api/dashboard',token);
  assert.equal(r.status,200);
  assert.equal(Object.hasOwn(r.body,'finance'),false);
 }
 const a=await f.send('/api/dashboard',admin);
 assert.equal(a.status,200);assert.ok(a.body.finance);
});

test('P0: reversing part cannot cross OS boundary',()=>{
 const db=fixture();
 try{
  const c=createCustomer(db,{name:'Cliente'}),machine=createMachine(db,{customerId:c.id,type:'Carro'});
  const os1=createWorkOrder(db,{customerId:c.id,machineId:machine.id,problemReported:'Falha A'});
  const os2=createWorkOrder(db,{customerId:c.id,machineId:machine.id,problemReported:'Falha B'});
  const part=createPart(db,{sku:'CROSS-OS-PART',description:'Filtro'});
  addInventoryMovement(db,part.id,{type:'ENTRADA',quantity:5});
  db.prepare("UPDATE work_orders SET status='APROVADA' WHERE id IN (?,?)").run(os1.id,os2.id);
  const consumption=consumePart(db,os1.id,part.id,{quantity:2});
  assert.throws(()=>reverseWorkOrderPart(db,consumption.id,{workOrderId:os2.id}),/outra OS|não pertence|vínculo/i);
  assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,3);
  assert.equal(db.prepare('SELECT reversed_at FROM work_order_parts WHERE id=?').get(consumption.id).reversed_at,null);
 }finally{db.close()}
});

test('P0: stale OS update must fail with expectedVersion and preserve first editor',()=>{
 const db=fixture();
 try{
  const c=createCustomer(db,{name:'Cliente'}),m=createMachine(db,{customerId:c.id,type:'Carro'});
  const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Original'});
  assert.equal(typeof getWorkOrder(db,os.id).version,'number');
  const updated=updateWorkOrder(db,os.id,{expectedVersion:os.version,problemReported:'Primeiro editor'});
  assert.equal(updated.version,os.version+1);
  assert.throws(()=>updateWorkOrder(db,os.id,{expectedVersion:os.version,problemReported:'Editor atrasado'}),/conflito|alterada por outro/i);
  assert.equal(getWorkOrder(db,os.id).problem_reported,'Primeiro editor');
 }finally{db.close()}
});

test('P0: LAN HTTP without explicit permission is disabled by default',()=>{
 const config=resolveServerConfig({PORT:'3344'});
 assert.equal(config.host,'127.0.0.1');
 assert.throws(()=>resolveServerConfig({HOST:'0.0.0.0',PORT:'3344'}),/HTTPS|TLS|LAN/i);
 const enabled=resolveServerConfig({HOST:'0.0.0.0',PORT:'3344',TLS_CERT_PATH:'/tmp/cert',TLS_KEY_PATH:'/tmp/key'});
 assert.equal(enabled.host,'0.0.0.0');assert.equal(enabled.secure,true);
});

test('P0: upload maxBytes from user cannot override server limit',()=>{
 const db=fixture();
 try{
  const c=createCustomer(db,{name:'Cliente'}),m=createMachine(db,{customerId:c.id,type:'Carro'});
  const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Entrada'});
  assert.throws(()=>saveAttachment(db,os.id,{
    category:'ENTRADA',mimeType:'image/png',base64:Buffer.alloc(5*1024*1024+100,0x41).toString('base64'),
    maxBytes:20*1024*1024,originalName:'imagem.png',storageDir:'/tmp/p0-uploads'
  }),/limite|excede/i);
 }finally{db.close()}
});

test('P0: login attempts must be rate-limited without allowing brute force',async t=>{
 const f=await appFixture(t);
 let limited=false;
 for(let i=0;i<10;i++){
  const r=await f.send('/api/auth/login',null,{method:'POST',body:{username:'admin',password:'incorrecta'}});
  if(r.status===429){limited=true;break}
 }
 assert.equal(limited,true);
});
