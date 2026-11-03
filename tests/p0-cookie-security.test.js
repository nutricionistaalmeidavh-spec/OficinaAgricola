import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createUser} from '../src/auth.js';
import {createAssistenciaServer} from '../src/server-assistencia.js';

async function app(t){
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 createUser(db,{username:'sessionadmin',name:'Gestor',role:'ADMIN',password:'MinhaSenhaSessao2026!'});
 const server=createAssistenciaServer({db});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();db.close()});
 return {base:`http://127.0.0.1:${server.address().port}`,db};
}
test('P0: navegador recebe cookie HttpOnly, nunca token em JSON ou localStorage',async t=>{
 const {base}=await app(t);
 const r=await fetch(base+'/api/auth/login',{
   method:'POST',headers:{'Content-Type':'application/json','X-Session-Transport':'cookie'},
   body:JSON.stringify({username:'sessionadmin',password:'MinhaSenhaSessao2026!'})
 });
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.token,undefined);assert.equal(data.user.role,'ADMIN');
 const cookie=r.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 assert.match(cookie,/Path=\/api/);assert.match(cookie,/Max-Age=43200/);
 const header=cookie.split(';')[0];
 const me=await fetch(base+'/api/auth/me',{headers:{cookie:header}});
 assert.equal(me.status,200);assert.equal((await me.json()).username,'sessionadmin');
 assert.equal(me.headers.get('x-frame-options'),'DENY');
 const tamper=await fetch(base+'/api/company',{
   method:'PATCH',headers:{cookie:header,'Content-Type':'application/json',Origin:'https://evil.example'},
   body:JSON.stringify({name:'Invasão'})});
 assert.equal(tamper.status,403);
 const absent=await fetch(base+'/api/company',{
   method:'PATCH',headers:{cookie:header,'Content-Type':'application/json'},
   body:JSON.stringify({name:'Sem origem'})});
 assert.equal(absent.status,403);
 const good=await fetch(base+'/api/company',{
   method:'PATCH',headers:{cookie:header,'Content-Type':'application/json',Origin:base},
   body:JSON.stringify({name:'Empresa segura',requestId:'company-session-001'})});
 assert.equal(good.status,200);assert.equal((await good.json()).name,'Empresa segura');
 const logout=await fetch(base+'/api/auth/logout',{
   method:'POST',headers:{cookie:header,'Content-Type':'application/json',Origin:base},body:'{}'});
 assert.equal(logout.status,200);
 assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
test('P0: limitação de tentativas de senha bloqueia força bruta por IP',async t=>{
 const {base}=await app(t);
 const fail=()=>fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({username:'sessionadmin',password:'Errada!2026'})});
 for(let i=0;i<6;i++)assert.equal((await fail()).status,401);
 assert.equal((await fail()).status,429);
});
