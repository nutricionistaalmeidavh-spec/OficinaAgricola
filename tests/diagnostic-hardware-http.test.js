import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createAppServer} from '../src/server.js';

test('hardware probing and J1939 capture require login, technician role and local machine',async t=>{
 const db=openDatabase(':memory:');migrate(db);
 createUser(db,{username:'tech',password:'Admin@1234',role:'TECNICO',name:'Técnico'});
 createUser(db,{username:'fin',password:'Admin@1234',role:'FINANCEIRO',name:'Financeiro'});
 const calls=[],runner=async(action,params)=>{
  calls.push({action,params});
  if(action==='probe')return {j2534:{ready:true,drivers:[{key:'PassThru Test'}]},j1939:{ready:true,backends:['socketcan']}};
  if(action==='capture')return {adapterId:'J1939',source:'REAL',protocol:'SAE J1939 CAN - leitura passiva',
   j1939:{frames:[{id:0x0CF00400,data:'FF FF FF 40 1F FF FF FF'}]}};
  throw new Error('operação inválida');
 };
 const server=createAppServer({db,diagnosticRunner:runner});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,token)=>{const r=await fetch(base+path,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,data:await r.json()}};
 async function login(username){const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'Admin@1234'})});return (await response.json()).token}
 const tech=await login('tech'),fin=await login('fin');
 assert.equal((await request('/api/diagnostics/hardware')).status,401);
 assert.equal((await request('/api/diagnostics/hardware',fin)).status,403);
 const probe=await request('/api/diagnostics/hardware',tech);
 assert.equal(probe.status,200);
 assert.equal(probe.data.j2534.drivers[0].key,'PassThru Test');
 const capture=await request('/api/diagnostics/capture?adapterId=J1939&interface=socketcan&channel=can0&durationSeconds=5',tech);
 assert.equal(capture.status,200);
 assert.equal(capture.data.adapterId,'J1939');
 assert.deepEqual(calls.map(x=>x.action),['probe','capture']);
 assert.equal(calls[1].params.channel,'can0');
});
