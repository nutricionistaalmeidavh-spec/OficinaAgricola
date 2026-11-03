import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createAppServer} from '../src/server.js';

test('API automotiva persiste perfil, aplicações, scans e planos com RBAC',async t=>{
  const db=openDatabase(':memory:');migrate(db);
  createUser(db,{username:'admin',password:'Admin@1234',role:'ADMIN',name:'Administrador'});
  createUser(db,{username:'fin',password:'Admin@1234',role:'FINANCEIRO',name:'Financeiro'});
  const server=createAppServer({db});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.close();db.close()});
  const base='http://127.0.0.1:'+server.address().port;
  const req=async(path,{method='GET',token,body}={})=>{
    const headers={};if(token)headers.Authorization='Bearer '+token;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const raw=await response.text();return {status:response.status,data:raw?JSON.parse(raw):null};
  };
  const a=(await req('/api/auth/login',{method:'POST',body:{username:'admin',password:'Admin@1234'}})).data.token;
  const fin=(await req('/api/auth/login',{method:'POST',body:{username:'fin',password:'Admin@1234'}})).data.token;
  assert.equal((await req('/api/maintenance-alerts')).status,401);
  assert.equal((await req('/api/company',{method:'PATCH',token:fin,body:{serviceProfile:'AUTOMOTIVA'}})).status,403);
  assert.equal((await req('/api/company',{method:'PATCH',token:a,body:{serviceProfile:'AUTOMOTIVA'}})).data.service_profile,'AUTOMOTIVA');
  const client=(await req('/api/customers',{method:'POST',token:a,body:{name:'Frota Multimarcas'}})).data;
  const car=(await req('/api/machines',{method:'POST',token:a,body:{
    customerId:client.id,type:'Carro',brand:'Volkswagen',model:'Gol',year:2020,
    renavam:'12345678901',engine:'1.6 MSI',fuelType:'FLEX',odometerKm:40000}})).data;
  assert.equal(car.renavam,'12345678901');
  const piece=(await req('/api/parts',{method:'POST',token:a,body:{sku:'VW-01',description:'Filtro de óleo'}})).data;
  assert.equal((await req('/api/parts/'+piece.id+'/fitments',{method:'POST',token:a,body:{
    brand:'Volkswagen',model:'Gol',yearFrom:2018,yearTo:2022}})).status,200);
  const fitment=(await req('/api/machines/'+car.id+'/compatible-parts',{token:a})).data;
  assert.deepEqual(fitment.map(x=>x.sku),['VW-01']);
  const plan=(await req('/api/machines/'+car.id+'/maintenance-plans',{method:'POST',token:a,body:{
    name:'Trocar óleo',intervalKm:10000,startingKm:40000,intervalDays:180,startingDate:'2026-01-01'}})).data;
  assert.equal(plan.next_due_km,50000);
  const obs=(await req('/api/machines/'+car.id+'/obd-scans',{method:'POST',token:a,body:{
    rawResponse:'43 01 33 00 00',protocol:'ELM327'}})).data;
  assert.equal(JSON.parse(obs.codes_json)[0],'P0133');
  assert.equal((await req('/api/machines/'+car.id+'/obd-scans',{method:'POST',token:fin,body:{rawResponse:'43 00 00'}})).status,403);
  assert.equal((await req('/api/maintenance-alerts',{token:a})).status,200);
  assert.equal((await req('/api/maintenance-plans/'+plan.id+'/complete',{method:'POST',token:a,body:{
    performedAt:'2026-07-01',odometerKm:41000}})).data.next_due_km,51000);
});
