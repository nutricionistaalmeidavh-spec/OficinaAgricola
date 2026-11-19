import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresUnifiedGateway} from '../src/platform/postgres-unified-gateway.js';

const registry={
  validateSession:async()=>{throw Error('Unexpected authentication');},
  requireUnitMembership:async()=>{},
  listUserUnits:async()=>[],
  recoverInitialAdminPassword:async()=>({updated:true})
};
const licenseControl={
  required:true,status:async()=>({active:true}),
  requestRecovery:async()=>({accepted:true}),
  verifyRecovery:async()=>({verified:true})
};
const gateway=createPostgresUnifiedGateway({
  registry,serviceToken:'T'.repeat(48),tenantHandlerForUnit:async()=>{},
  licenseControl
});
test('licensed administrator can request password recovery by email',async()=>{
  const response=await gateway(new Request('http://127.0.0.1:3344/api/auth/recovery/request',{
    method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3344'},
    body:JSON.stringify({email:'owner@example.com'})
  }));
  assert.equal(response.status,202);
  assert.equal((await response.json()).accepted,true);
});


test('valid one-time email code resets only the local administrator',async()=>{
 let verifyCalls=0,resetCalls=0;
 const mockRegistry={
  ...registry,
  async recoverInitialAdminPassword(password){
   resetCalls++;assert.equal(password,'NovaSenha#2026');return {updated:true,username:'gestor'};
  }
 };
 const mockLicense={
  ...licenseControl,
  async verifyRecovery({email,code}){
   verifyCalls++;assert.equal(email,'owner@example.com');assert.equal(code,'123456');
   return {verified:true};
  }
 };
 const app=createPostgresUnifiedGateway({registry:mockRegistry,
  serviceToken:'T'.repeat(48),tenantHandlerForUnit:async()=>{},licenseControl:mockLicense});
 const body={email:'owner@example.com',code:'123456',password:'NovaSenha#2026',confirmPassword:'NovaSenha#2026'};
 const confirm=async payload=>app(new Request('http://127.0.0.1:3344/api/auth/recovery/confirm',{
  method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3344'},
  body:JSON.stringify(payload)
 }));
 assert.equal((await confirm({...body,confirmPassword:'diferente'})).status,400);
 assert.equal((await confirm({...body,code:'123'})).status,400);
 assert.equal(verifyCalls,0);
 assert.equal(resetCalls,0);
 const response=await confirm(body);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{updated:true,username:'gestor'});
 assert.equal(verifyCalls,1);
 assert.equal(resetCalls,1);
});

test('reset fails closed when Cloudflare denies code, without DB write',async()=>{
 let resetCalls=0;
 const mockRegistry={...registry,recoverInitialAdminPassword:async()=>{resetCalls++}};
 const app=createPostgresUnifiedGateway({registry:mockRegistry,
  serviceToken:'T'.repeat(48),tenantHandlerForUnit:async()=>{},
  licenseControl:{...licenseControl,verifyRecovery:async()=>({verified:false})}});
 const response=await app(new Request('http://127.0.0.1:3344/api/auth/recovery/confirm',{
  method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3344'},
  body:JSON.stringify({email:'owner@example.com',code:'123456',password:'NovaSenha#2026',confirmPassword:'NovaSenha#2026'})
 }));
 assert.notEqual(response.status,200);
 assert.equal(resetCalls,0);
});

test('self-hosted free edition does not depend on Cloudflare to use ordinary login',async()=>{
 const app=createPostgresUnifiedGateway({registry,serviceToken:'T'.repeat(48),
  tenantHandlerForUnit:async()=>{},licenseControl:{required:false,status:async()=>({active:true})}});
 const response=await app(new Request('http://127.0.0.1:3344/api/auth/recovery/request',{
  method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3344'},
  body:JSON.stringify({email:'owner@example.com'})
 }));
 assert.equal(response.status,404);
});


test('Central Cloudflare 503 on email recovery is not presented as PostgreSQL outage',async()=>{
 const simulatedLicense={...licenseControl,requestRecovery:async()=>{
  throw Object.assign(new Error('Falha no envio de e-mail pela Central Cloudflare'),{status:503});
 }};
 const app=createPostgresUnifiedGateway({
  registry,licenseControl:simulatedLicense,serviceToken:'T'.repeat(48),tenantHandlerForUnit:async()=>{}
 });
 const response=await app(new Request('http://127.0.0.1:3344/api/auth/recovery/request',{
  method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3344'},
  body:JSON.stringify({email:'owner@example.com'})
 }));
 assert.equal(response.status,503);
 const payload=await response.json();
 assert.match(payload.error,/e-mail|código|Cloudflare/i);
 assert.doesNotMatch(payload.error,/PostgreSQL/i);
});
