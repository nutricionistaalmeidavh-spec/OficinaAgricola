import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {seed} from '../src/seed.js';
import {createAssistenciaServer} from '../src/server-assistencia.js';
import {isLocalSetupRequest} from '../src/setup.js';

test('fresh production database never creates a default admin/password',()=>{
 const db=openDatabase(':memory:');
 try {migrate(db);migrateAssistencia(db);
   const result=seed(db,{nodeEnv:'production'});
   assert.equal(result.setupRequired,true);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
 }finally{db.close()}
});

test('onboarding only permits loopback host, socket and same-origin requests',()=>{
 assert.equal(isLocalSetupRequest({socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3344'}}),true);
 assert.equal(isLocalSetupRequest({socket:{remoteAddress:'192.168.1.3'},headers:{host:'127.0.0.1:3344'}}),false);
 assert.equal(isLocalSetupRequest({socket:{remoteAddress:'127.0.0.1'},headers:{host:'evil.example'}}),false);
 assert.equal(isLocalSetupRequest({socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3344',origin:'https://evil.example'}}),false);
});

test('first setup rejects weak passwords and creates exactly one ADMIN via local API',async t=>{
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);seed(db,{nodeEnv:'production'});
 const app=createAssistenciaServer({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();db.close()});
 const base=`http://127.0.0.1:${app.address().port}`;
 const request=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=await (await fetch(base+'/api/setup/status')).json();assert.equal(state.required,true);
 const bad=await request('/api/setup/initialize',{username:'admin',name:'Administrador',password:'Admin@1234',confirmPassword:'Admin@1234'});
 assert.equal(bad.status,400);
 const input={username:'gestor',name:'Gestor Oficina',password:'MinhaChaveForte2026!A',confirmPassword:'MinhaChaveForte2026!A'};
 const result=await request('/api/setup/initialize',input);assert.equal(result.status,200);
 assert.equal((await result.json()).username,'gestor');
 const duplicate=await request('/api/setup/initialize',input);assert.equal(duplicate.status,409);
 assert.equal((await (await fetch(base+'/api/setup/status')).json()).required,false);
 const login=await request('/api/auth/login',{username:'gestor',password:input.password});assert.equal(login.status,200);
 assert.equal((await login.json()).user.role,'ADMIN');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
});
