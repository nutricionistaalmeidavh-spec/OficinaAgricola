import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createUser} from '../src/auth.js';
import {createAssistenciaServer} from '../src/server-assistencia.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,updateWorkOrder} from '../src/services/work-orders.js';
import {createPart,addInventoryMovement,consumePart,reverseWorkOrderPart} from '../src/services/inventory.js';
import {dashboardData} from '../src/services/dashboard.js';
import {resolveServerConfig,assertSecureNetwork} from '../src/platform/network.js';
import {saveAttachment} from '../src/services/operations.js';

function database(){
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 createUser(db,{username:'admin',name:'Administrador',role:'ADMIN',password:'SenhaForteP0!2026'});
 createUser(db,{username:'tecnico',name:'Técnico',role:'TECNICO',password:'SenhaForteP0!2026'});
 const c=createCustomer(db,{name:'Cliente A'}),m=createMachine(db,{customerId:c.id,type:'Trator'});
 const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Revisão'});
 return {db,c,m,os};
}
async function server(t,db){
 const app=createAssistenciaServer({db});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(()=>{app.close();db.close()});
 const base='http://127.0.0.1:'+app.address().port;
 const send=async(path,{method='GET',body,token,headers={}}={})=>{
   const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
     ...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
   return {status:r.status,data:await r.json(),headers:r.headers};
 };
 const login=async username=>{
   const r=await send('/api/auth/login',{method:'POST',body:{username,password:'SenhaForteP0!2026'}});
   assert.equal(r.status,200);
   return r.data.token;
 };
 return {base,send,login};
}
test('P0 autorização: técnico não vê valores financeiros nem nos dados do dashboard',async t=>{
 const {db}=database(),api=await server(t,db),token=await api.login('tecnico');
 const r=await api.send('/api/dashboard',{token});
 assert.equal(r.status,200);
 assert.equal(Object.hasOwn(r.data,'finance'),false);
 assert.equal(Object.hasOwn(dashboardData(db,{role:'TECNICO'}),'finance'),false);
 const admin=await api.send('/api/dashboard',{token:await api.login('admin')});
 assert.equal(admin.status,200);assert.ok(admin.data.finance);
});
test('P0 IDOR: estorno de peça não pode cruzar identificador de OS da URL',async t=>{
 const {db,c,m,os}=database();
 const os2=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Outra'});
 db.prepare("UPDATE work_orders SET status='APROVADA' WHERE id IN (?,?)").run(os.id,os2.id);
 const p=createPart(db,{sku:'PART-P0',description:'Peça'});
 addInventoryMovement(db,p.id,{type:'ENTRADA',quantity:10});
 const used=consumePart(db,os.id,p.id,{quantity:2});
 const api=await server(t,db),token=await api.login('admin');
 const bad=await api.send(`/api/work-orders/${os2.id}/parts/${used.id}/reverse`,{
   method:'POST',body:{requestId:'cross-os-reverse'},token});
 assert.equal(bad.status,409);
 assert.equal(db.prepare('SELECT reversed_at FROM work_order_parts WHERE id=?').get(used.id).reversed_at,null);
 const good=await api.send(`/api/work-orders/${os.id}/parts/${used.id}/reverse`,{
   method:'POST',body:{requestId:'right-os-reverse'},token});
 assert.equal(good.status,200);
});
test('P0 versionamento: atualizações concorrentes de OS não sobrescrevem estado já salvo',()=>{
 const {db,os}=database();
 try{
   const a=updateWorkOrder(db,os.id,{diagnosis:'Diagnóstico A',expectedVersion:1});
   assert.equal(a.version,2);
   assert.throws(()=>updateWorkOrder(db,os.id,{diagnosis:'Diagnóstico obsoleto',expectedVersion:1}),/conflito|versão|atualizada/i);
   assert.equal(db.prepare('SELECT diagnosis FROM work_orders WHERE id=?').get(os.id).diagnosis,'Diagnóstico A');
 }finally{db.close()}
});
test('P0 LAN: sem TLS não anuncia porta pública; conexão remota HTTP é negada',()=>{
 assert.equal(resolveServerConfig({}).host,'127.0.0.1');
 assert.throws(()=>resolveServerConfig({HOST:'0.0.0.0'}),/HTTPS|TLS|certificado/i);
 assert.equal(resolveServerConfig({HOST:'0.0.0.0',HTTPS_CERT_FILE:'/cert.pem',HTTPS_KEY_FILE:'/key.pem'}).host,'0.0.0.0');
 assert.throws(()=>assertSecureNetwork({socket:{remoteAddress:'192.168.1.42',encrypted:false}}),/HTTPS|segur/i);
 assert.doesNotThrow(()=>assertSecureNetwork({socket:{remoteAddress:'127.0.0.1',encrypted:false}}));
 assert.doesNotThrow(()=>assertSecureNetwork({socket:{remoteAddress:'192.168.1.42',encrypted:true}}));
});
test('P0 anexo: request não pode aumentar o limite do servidor',()=>{
 const {db,os}=database();
 try{
   const payload={category:'ENTRADA',mimeType:'image/png',maxBytes:20*1024*1024,
     base64:Buffer.alloc(5*1024*1024+1,0).toString('base64')};
   assert.throws(()=>saveAttachment(db,os.id,payload),/limite|excede/i);
 }finally{db.close()}
});
test('P0 consulta do comando: status é isolado por usuário e retorna apenas resultado próprio',async t=>{
 const {db}=database(),api=await server(t,db);
 const admin=await api.login('admin'),tech=await api.login('tecnico');
 const body={name:'Cliente com replay',requestId:'p0-persisted-777'};
 const created=await api.send('/api/customers',{method:'POST',body,token:admin});
 assert.equal(created.status,200);
 const qs='?method=POST&path='+encodeURIComponent('/api/customers')+'&requestId='+body.requestId;
 const own=await api.send('/api/commands/status'+qs,{token:admin});
 assert.equal(own.status,200);assert.equal(own.data.status,'CONFIRMED');
 const foreign=await api.send('/api/commands/status'+qs,{token:tech});
 assert.equal(foreign.status,200);assert.equal(foreign.data.status,'UNKNOWN');
});
