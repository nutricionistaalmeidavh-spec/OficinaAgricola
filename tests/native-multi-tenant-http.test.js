import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createMultiTenantServer} from '../src/platform/multi-tenant-server.js';
import {createCustomer} from '../src/services/catalog.js';

test('native tenant dispatch validates global login and tenant, never reads shadow SQLite',async t=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-native-bridge-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const legacy=openDatabase(':memory:'),registry=openDatabase(':memory:');
 t.after(()=>{try{legacy.close();}catch{}try{registry.close();}catch{}});
 migrate(legacy);
 createUser(legacy,{username:'manager',name:'Manager',password:'StrongP@ss2026',role:'ADMIN'});
 createCustomer(legacy,{name:'SQLite-only customer'});
 const calls=[];
 const backend={companyId:1,unitId:1,endpoint:'http://127.0.0.1:3456',
  serviceToken:'e'.repeat(40)};
 const server=createMultiTenantServer({
  registryDb:registry,legacyDb:legacy,tenantsRoot:join(root,'tenants'),
  legacyStorageDir:join(root,'uploads'),
  nativeBackendForUnit:unit=>unit.id===1?backend:null,
  nativeApiBridge:async input=>{
   calls.push(input);
   if(input.path==='/api/customers')return {status:200,body:[{id:99,name:'PG-only customer'}]};
   throw Error('Unexpected remote path');
  }
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const login=await fetch(base+'/api/auth/login',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({username:'manager',password:'StrongP@ss2026'})});
 assert.equal(login.status,200);
 const credentials=await login.json();
 const headers={authorization:'Bearer '+credentials.token,'x-oficina-unit':'1'};
 const result=await fetch(base+'/api/customers',{headers});
 assert.equal(result.status,200);
 assert.deepEqual((await result.json()).map(x=>x.name),['PG-only customer']);
 assert.equal(calls.length,1);
 assert.equal(calls[0].unit.companyId,1);
 const unsupported=await fetch(base+'/api/diagnostics/hardware',{headers});
 assert.equal(unsupported.status,400,'mock gateway deliberately rejects unknown routes');
 assert.equal(legacy.prepare('SELECT COUNT(*) n FROM customers').get().n,1);
 const denied=await fetch(base+'/api/customers');
 assert.equal(denied.status,401);
});
