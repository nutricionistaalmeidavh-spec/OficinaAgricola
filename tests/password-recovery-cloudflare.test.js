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
