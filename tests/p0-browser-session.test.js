import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createAssistenciaServer} from '../src/server-assistencia.js';

test('P0 browser: login authenticates with HttpOnly SameSite cookie, without localStorage bearer token',async t=>{
 const db=openDatabase(':memory:');migrate(db);
 createUser(db,{username:'admin',role:'ADMIN',name:'Administrador',password:'SenhaSegura123!'});
 const app=createAssistenciaServer({db});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.close(r));db.close()});
 const origin=`http://127.0.0.1:${app.address().port}`;
 const login=await fetch(origin+'/api/auth/login',{method:'POST',
  headers:{'Content-Type':'application/json','X-Oficina-Client':'browser',Origin:origin},
  body:JSON.stringify({username:'admin',password:'SenhaSegura123!'})});
 assert.equal(login.status,200);
 const body=await login.json();assert.equal(Object.hasOwn(body,'token'),false);
 const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);
 assert.match(cookie,/SameSite=Strict/);
 const session=await fetch(origin+'/api/auth/me',{headers:{Cookie:cookie.split(';')[0]}});
 assert.equal(session.status,200);
 assert.equal((await session.json()).role,'ADMIN');
 const malicious=await fetch(origin+'/api/customers',{method:'POST',
  headers:{Cookie:cookie.split(';')[0],Origin:'http://evil.example','Content-Type':'application/json'},
  body:JSON.stringify({name:'Não pode'})});
 assert.equal(malicious.status,403);
 const logout=await fetch(origin+'/api/auth/logout',{method:'POST',
  headers:{Cookie:cookie.split(';')[0],Origin:origin,'Content-Type':'application/json'},body:'{}'});
 assert.equal(logout.status,200);
 assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
