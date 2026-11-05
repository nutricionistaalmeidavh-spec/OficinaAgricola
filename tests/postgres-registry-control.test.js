import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresRegistryControlHandler} from '../src/platform/postgres-registry-control.js';
const token='a'.repeat(48);
const calls=[];
const registry={
 async setupRequired(){return false;},
 async bootstrapAdmin(){throw Error('Nunca deve ser executado');},
 async validateSession(value){
   if(value!==token)throw Object.assign(new Error('Sessão inválida'),{status:401});
   return {id:10,username:'owner',name:'Owner',role:'ATENDIMENTO'};
 },
 async login(){return {token,user:{id:10,role:'ATENDIMENTO'},expiresAt:'2030-01-01T00:00:00.000Z'};},
 async logout(){return {ok:true};},
 async listUserUnits(){return [{id:1,companyId:5,role:'ADMIN'},{id:2,companyId:5,role:'TECNICO'}];},
 async isPlatformAdmin(){return true;},
 async requireUnitMembership(userId,unitId){
   calls.push(['membership',userId,unitId]);
   if(unitId===9)throw Object.assign(new Error('Permissão negada'),{status:403});
   return {id:unitId,companyId:5,role:unitId===1?'ADMIN':'TECNICO'};
 },
 async createCompany(actor,input){calls.push(['company',actor,input]);return {id:6};},
 async createUnit(actor,input){calls.push(['unit',actor,input]);return {id:3};},
 async grantMembership(actor,input){calls.push(['grant',actor,input]);return {id:11};},
 async changeMembership(actor,input){calls.push(['change',actor,input]);return {id:11};},
 async listAudit(){return [];},
 async listUnitMembers(){return [];}
};
const handler=createPostgresRegistryControlHandler({registry});
const req=(method,path,body,headers={})=>new Request('http://127.0.0.1'+path,{
 method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...headers},
 ...(body?{body:JSON.stringify(body)}:{})
});
test('global registry control API fails closed without personal session',async()=>{
 const res=await handler(new Request('http://127.0.0.1/api/tenancy/context'));
 assert.equal(res.status,401);
});
test('bootstrapping cannot be triggered when process has not explicitly authorized it',async()=>{
 const res=await handler(req('POST','/api/setup/initialize',{username:'attacker',password:'pass'}));
 assert.equal(res.status,403);
});
test('role and actor ID in JSON never override authenticated actor',async()=>{
 const res=await handler(req('POST','/api/tenancy/companies',{slug:'myco',name:'My Co',actorId:999,role:'ADMIN'}));
 assert.equal(res.status,201);
 assert.equal(calls.at(-1)[0],'company');
 assert.equal(calls.at(-1)[1],10);
});
test('member management ignores client unitId and userId path impersonation',async()=>{
 const res=await handler(req('POST','/api/users',{username:'person',role:'ADMIN',unitId:999},
   {'x-oficina-unit':'2'}));
 assert.equal(res.status,201);
 assert.equal(calls.at(-1)[0],'grant');
 assert.equal(calls.at(-1)[2].unitId,2);
});
test('ambiguous tenant requires explicit selection and unauthorized tenant is denied',async()=>{
 assert.equal((await handler(req('GET','/api/auth/me'))).status,409);
 assert.equal((await handler(req('GET','/api/auth/me',undefined,{'x-oficina-unit':'9'}))).status,403);
 const valid=await handler(req('GET','/api/auth/me',undefined,{'x-oficina-unit':'2'}));
 assert.equal((await valid.json()).role,'TECNICO');
});
test('unsupported operational routes fail explicitly instead of reaching SQLite',async()=>{
 const res=await handler(req('GET','/api/work-orders',undefined,{'x-oficina-unit':'1'}));
 assert.equal(res.status,501);
 const body=await res.json();
 assert.match(body.error,/não migrada/i);
});
test('500 responses do not leak database messages',async()=>{
 const failing=createPostgresRegistryControlHandler({registry:{...registry,validateSession:async()=>{throw Error('password=secret')}}});
 const response=await failing(req('GET','/api/tenancy/context'));
 assert.equal(response.status,500);
 assert.doesNotMatch(JSON.stringify(await response.json()),/secret/);
});
