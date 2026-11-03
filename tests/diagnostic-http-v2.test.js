import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createAppServer} from '../src/server.js';

test('API de diagnósticos: RBAC, equipamento, captura canônica, idempotência e PDF local',async t=>{
 const db=openDatabase(':memory:');migrate(db);
 createUser(db,{username:'admin',password:'Admin@1234',role:'ADMIN',name:'Admin'});
 createUser(db,{username:'finance',password:'Admin@1234',role:'FINANCEIRO',name:'Finance'});
 const server=createAppServer({db});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,{token,method='GET',body}={})=>{
   const headers={};if(token)headers.Authorization='Bearer '+token;
   if(body!==undefined)headers['Content-Type']='application/json';
   const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
   const raw=await response.text();
   return {status:response.status,raw,data:raw.startsWith('{')||raw.startsWith('[')?JSON.parse(raw):null,headers:response.headers};
 };
 const admin=(await request('/api/auth/login',{method:'POST',body:{username:'admin',password:'Admin@1234'}})).data.token;
 const finance=(await request('/api/auth/login',{method:'POST',body:{username:'finance',password:'Admin@1234'}})).data.token;
 assert.equal((await request('/api/diagnostics/adapters')).status,401);
 const adapters=await request('/api/diagnostics/adapters',{token:finance});
 assert.equal(adapters.status,200);
 assert.equal(adapters.data.find(x=>x.id==='J2534').available,false);
 const c=(await request('/api/customers',{token:admin,method:'POST',body:{name:'Cliente OBD'}})).data;
 const car=(await request('/api/machines',{token:admin,method:'POST',body:{customerId:c.id,type:'Carro',brand:'VW',model:'Gol'}})).data;
 const other=(await request('/api/machines',{token:admin,method:'POST',body:{customerId:c.id,type:'Carro',brand:'Ford',model:'Ka'}})).data;
 const url='/api/machines/'+car.id+'/obd-scans';
 const capture={adapterId:'SIMULATOR',source:'SIMULATED',notes:'Treinamento offline',
    protocol:'SIMULACAO',responses:{'03':'43 01 33 00 00','010C':'41 0C 1A F8'},
    samples:[{timeMs:0,responses:{'010C':'41 0C 1A F8'}},{timeMs:500,responses:{'010C':'41 0C 20 00'}}],
    requestId:'diagnostic-v2-http-test-1'};
 assert.equal((await request(url,{token:finance,method:'POST',body:capture})).status,403);
 const saved=await request(url,{token:admin,method:'POST',body:capture});
 assert.equal(saved.status,200);
 assert.equal(saved.data.source,'SIMULATED');
 assert.equal(JSON.parse(saved.data.details_json).samples.length,2);
 assert.equal((await request(url,{token:admin,method:'POST',body:capture})).data.id,saved.data.id);
 assert.equal((await request(url,{token:admin})).data.length,1);
 const pdf=await request(url+'/'+saved.data.id+'/pdf',{token:admin});
 assert.equal(pdf.status,200);
 assert.match(pdf.headers.get('content-type'),/application\/pdf/);
 assert.match(pdf.raw,/^%PDF-1\.4/);
 assert.equal((await request('/api/machines/'+other.id+'/obd-scans/'+saved.data.id+'/pdf',{token:admin})).status,404);
 assert.equal((await request(url+'/'+saved.data.id+'/pdf')).status,401);
 assert.equal((await request(url,{token:admin,method:'POST',body:{adapterId:'SIMULATOR',source:'REAL',responses:{'03':'43 00 00'}}})).status,400);
 assert.equal((await request(url,{token:admin,method:'POST',body:{adapterId:'J2534',responses:{'03':'43 00 00'}}})).status,400);
 const legacy=await request(url,{token:admin,method:'POST',body:{protocol:'ELM327',rawResponse:'43 00 00'}});
 assert.equal(legacy.status,200);
 assert.equal(legacy.data.source,'REAL');
});
