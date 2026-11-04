import test from 'node:test';
import assert from 'node:assert/strict';
import {requiredNativeRoles,serviceOnlyNativeRoute} from '../src/platform/async-workshop-policy.js';
test('native setup, login and migration only use the protected service boundary',()=>{
 for(const route of ['/v1/migrate','/v1/health','/v1/auth/bootstrap','/v1/auth/login','/v1/auth/users','/v1/auth/logout'])
   assert.equal(serviceOnlyNativeRoute(route),true,route);
 assert.equal(serviceOnlyNativeRoute('/v1/customers'),false);
});
test('native financial and fiscal operations reject technician role',()=>{
 for(const path of ['/v1/reports/finance','/v1/expenses','/v1/cash/summary','/v1/sales','/v1/fiscal','/v1/fiscal/4/events'])
   assert.ok(!requiredNativeRoles('GET',path).includes('TECNICO'),path);
 assert.deepEqual(requiredNativeRoles('POST','/v1/fiscal/2/submit'),['ADMIN']);
 assert.ok(!requiredNativeRoles('POST','/v1/payments').includes('ATENDIMENTO'));
});
test('native workshop operations are scoped to eligible roles',()=>{
 assert.ok(requiredNativeRoles('GET','/v1/customers').includes('TECNICO'));
 assert.ok(requiredNativeRoles('POST','/v1/orders/5/status').includes('TECNICO'));
 assert.ok(!requiredNativeRoles('POST','/v1/technicians').includes('TECNICO'));
 assert.deepEqual(requiredNativeRoles('PATCH','/v1/fiscal/settings'),['ADMIN']);
 assert.ok(!requiredNativeRoles('DELETE','/v1/unknown').includes('TECNICO'));
});
