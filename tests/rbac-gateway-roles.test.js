import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresUnifiedGateway} from '../src/platform/postgres-unified-gateway.js';

const token='A'.repeat(48),serviceToken='B'.repeat(48);
const roles=['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO'];
const registry={
 async validateSession(value){
  if(value!==token)throw Object.assign(new Error('Sessão inválida'),{status:401});
  return {id:55,name:'Operador',username:'operador',role:'ATENDIMENTO'};
 },
 async listUserUnits(){return roles.map((role,i)=>({id:i+1,companyId:10,role}));},
 async requireUnitMembership(_actor,unitId){
  if(!roles[unitId-1])throw Object.assign(new Error('Sem vínculo'),{status:403});
  return {id:unitId,companyId:10,role:roles[unitId-1]};
 }
};
let reached=0;
const gateway=createPostgresUnifiedGateway({
 registry,serviceToken,
 tenantHandlerForUnit:async unit=>async request=>{
  const route=new URL(request.url).pathname;
  if(route==='/v1/internal/gateway-session')return Response.json({ok:true});
  reached++;
  return Response.json({ok:true,unitId:unit.id,route});
 }
});
async function check(role,method,path){
 const unit=roles.indexOf(role)+1;
 const response=await gateway(new Request('http://localhost:3344'+path,{
  method,
  headers:{
   authorization:'Bearer '+token,
   origin:'http://localhost:3344',
   'x-oficina-unit':String(unit),
   ...(method==='GET'?{}:{'content-type':'application/json'})
  },
  ...(method==='GET'?{}:{body:'{}'})
 }));
 return response.status;
}

test('gateway financial ledgers are private to admin and finance',async()=>{
 for(const path of ['/api/work-orders/7/payment','/api/work-orders/7/receipts',
  '/api/finance/summary','/api/fiscal']){
  assert.equal(await check('ADMIN','GET',path),200,path);
  assert.equal(await check('FINANCEIRO','GET',path),200,path);
  for(const role of ['TECNICO','ATENDIMENTO'])
   assert.equal(await check(role,'GET',path),403,role+' '+path);
 }
});

test('the unit membership role, not global account role, authorizes each operation',async()=>{
 const cases=[
  ['POST','/api/customers',['ADMIN','ATENDIMENTO']],
  ['POST','/api/work-orders/7/checklists',['ADMIN','ATENDIMENTO','TECNICO']],
  ['POST','/api/work-orders/7/attachments',['ADMIN','ATENDIMENTO','TECNICO']],
  ['POST','/api/expenses',['ADMIN','FINANCEIRO']],
  ['POST','/api/fiscal/7/cancel',['ADMIN']],
  ['POST','/api/sales/7/cancel',['ADMIN','FINANCEIRO']],
  ['GET','/api/reports',roles]
 ];
 for(const [method,path,permitted] of cases)
  for(const role of roles)
   assert.equal(await check(role,method,path),permitted.includes(role)?200:403,
    method+' '+path+' as '+role);
});
