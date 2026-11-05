import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLegacyNativeRoute,nativeRouteCoverage} from '../src/platform/native-api-route-map.js';
import {requiredNativeRoles} from '../src/platform/async-workshop-policy.js';

const sample=template=>template.replace(/:([A-Za-z]+)/g,(_,name)=>
  name==='plate'?'ABC1D23':['intentId','planId','installmentId','entryId','refundId'].includes(name)?
    'a'.repeat(32):'7');

test('gateway and native operational RBAC agree for every advertised route and method',()=>{
  for(const signature of nativeRouteCoverage){
    const [method,template]=signature.split(' ');
    const mapping=mapLegacyNativeRoute(method,sample(template));
    assert.ok(mapping,signature);
    assert.deepEqual(
      [...requiredNativeRoles(method,mapping.path)].sort(),
      [...mapping.roles].sort(),
      signature+' => '+mapping.path
    );
  }
});

test('technician and reception cannot view operational payment ledgers',()=>{
  for(const route of ['/api/work-orders/7/payment','/api/work-orders/7/receipts']){
    const mapping=mapLegacyNativeRoute('GET',route);
    assert.ok(mapping,route);
    assert.deepEqual(mapping.roles,['ADMIN','FINANCEIRO'],route);
  }
});

test('technician can save OS checklists and attachments but not reverse receipts',()=>{
  for(const route of ['/v1/orders/7/checklists','/v1/orders/7/attachments']){
    assert.ok(requiredNativeRoles('POST',route).includes('TECNICO'),route);
  }
  assert.deepEqual(requiredNativeRoles('POST','/v1/orders/7/receipts/3/reverse'),
    ['ADMIN','FINANCEIRO']);
  assert.deepEqual(requiredNativeRoles('POST','/v1/fiscal/7/cancel'),['ADMIN']);
});
