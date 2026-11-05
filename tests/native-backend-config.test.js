import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadNativeTenantBackends} from '../src/platform/native-backend-config.js';

test('native per-unit routing remains disabled unless explicitly approved',t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-native-config-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'backends.json');
 writeFileSync(file,JSON.stringify([{companyId:2,unitId:3,
  endpoint:'http://127.0.0.1:3456',serviceTokenEnv:'OFICINA_NATIVE_SERVICE_TOKEN'}]));
 assert.equal(loadNativeTenantBackends(null)({id:3,companyId:2}),null);
 assert.throws(()=>loadNativeTenantBackends(file,{OFICINA_NATIVE_SERVICE_TOKEN:'x'.repeat(40)}),/aprova|habilita/i);
 const resolve=loadNativeTenantBackends(file,{
  TENANCY_NATIVE_CUTOVER_APPROVED:'true',OFICINA_NATIVE_SERVICE_TOKEN:'x'.repeat(40)
 });
 assert.equal(resolve({id:3,companyId:2}).unitId,3);
 assert.equal(resolve({id:3,companyId:2}).serviceToken,'x'.repeat(40));
 assert.equal(resolve({id:1,companyId:2}),null);
});
test('native config rejects credentials in JSON and missing environment secret',t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-native-bad-config-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'native.json'),env={TENANCY_NATIVE_CUTOVER_APPROVED:'true'};
 writeFileSync(file,JSON.stringify([{companyId:1,unitId:2,
  endpoint:'https://example.com',serviceToken:'hardcoded'}]));
 assert.throws(()=>loadNativeTenantBackends(file,env),/credencia|secrets|token/i);
 writeFileSync(file,JSON.stringify([{companyId:1,unitId:2,
  endpoint:'https://example.com',serviceTokenEnv:'OFICINA_NATIVE_SERVICE_TOKEN'}]));
 assert.throws(()=>loadNativeTenantBackends(file,env),/token|variável|ambiente/i);
});
