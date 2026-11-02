import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createUser} from '../src/auth.js';
import {createAssistenciaServer} from '../src/server-assistencia.js';
import {createEventRuntime} from '../src/platform/event-runtime.js';
import {dispatchOutbox} from '../src/platform/outbox.js';

test('P0 HTTP: duplicar requestId mantém 1 cliente, 1 movimentação e 1 evento persistido',async t=>{
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 createUser(db,{username:'admin',password:'SenhaForteP02026!',name:'Administrador',role:'ADMIN'});
 const seen=[];
 const runtime=createEventRuntime({integrations:[{name:'audit-probe',handle:event=>seen.push(event)}]});
 const app=createAssistenciaServer({db,eventRuntime:runtime});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(()=>{app.close();runtime.close();db.close()});
 const base=`http://127.0.0.1:${app.address().port}`;
 const send=async(method,path,body,token)=>{
   const res=await fetch(base+path,{method,headers:{
     ...(token?{Authorization:`Bearer ${token}`}:{}),
     'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await res.json();
   assert.equal(res.status,200,JSON.stringify(data));return data;
 };
 const login=await send('POST','/api/auth/login',{username:'admin',password:'SenhaForteP02026!'});
 const token=login.token;
 const body={name:'Cliente exatamente uma vez',requestId:'client-p0-retry'};
 const a=await send('POST','/api/customers',body,token);
 const b=await send('POST','/api/customers',body,token);
 assert.equal(b.id,a.id);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM customers WHERE name=?').get(body.name).n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM domain_outbox WHERE event_type='ENTITY_MUTATED' AND event_key LIKE '%/api/customers%'").get().n,1);
 const part=await send('POST','/api/parts',{sku:'HTTP-P0',description:'Peça',requestId:'new-part-p0'},token);
 const input={partId:part.id,type:'ENTRADA',quantity:8,requestId:'http-stock-p0'};
 const once=await send('POST','/api/inventory/movements',input,token);
 const again=await send('POST','/api/inventory/movements',input,token);
 assert.equal(again.id,once.id);
 assert.equal(db.prepare('SELECT quantity FROM parts WHERE id=?').get(part.id).quantity,8);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE part_id=?').get(part.id).n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM domain_outbox WHERE event_type='INVENTORY_MOVED'").get().n,1);
 await dispatchOutbox(db,runtime);
 assert.equal(new Set(seen.map(e=>e.eventId)).size,seen.length);
});

test('P0 HTTP: a auditoria genérica nunca persiste senha no payload dos eventos',async t=>{
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 createUser(db,{username:'admin',password:'SenhaForteP02026!',name:'Administrador',role:'ADMIN'});
 const app=createAssistenciaServer({db});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>{app.close();db.close()});
 const base=`http://127.0.0.1:${app.address().port}`;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({username:'admin',password:'SenhaForteP02026!'})});
 const {token}=await login.json();
 const r=await fetch(base+'/api/users',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({requestId:'new-user-p0',username:'novo',name:'Novo',role:'ATENDIMENTO',password:'OutroSegredoP0!2026'})});
 assert.equal(r.status,200);
 const rows=db.prepare("SELECT payload_json FROM domain_outbox WHERE event_type='ENTITY_MUTATED'").all();
 assert.equal(rows.length,1);
 assert.equal(JSON.stringify(rows).includes('OutroSegredoP0!2026'),false);
});
