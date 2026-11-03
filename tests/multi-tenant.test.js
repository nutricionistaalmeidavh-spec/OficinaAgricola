import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openDatabase, migrate } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { createCustomer } from '../src/services/catalog.js';
import { createMultiTenantServer } from '../src/platform/multi-tenant-server.js';
import { migrateTenantRegistry, listUserUnits, requireUnitMembership } from '../src/platform/tenant-registry.js';

test('legacy users and data are adopted without altering the original database', () => {
  const legacy=openDatabase(':memory:'),registry=openDatabase(':memory:');
  try{
    migrate(legacy);
    const id=createUser(legacy,{username:'admin',password:'StrongP@ss2026',role:'ADMIN',name:'Administrador'});
    createCustomer(legacy,{name:'Cliente pré-existente'});
    migrateTenantRegistry(registry,legacy);
    assert.equal(listUserUnits(registry,id).length,1);
    assert.equal(legacy.prepare('SELECT COUNT(*) n FROM customers').get().n,1);
    assert.throws(()=>requireUnitMembership(registry,id,777),{status:403});
    migrateTenantRegistry(registry,legacy);
    assert.equal(registry.prepare('SELECT COUNT(*) n FROM users').get().n,1);
  }finally{registry.close();legacy.close();}
});

test('HTTP isolation: company and unit records, member roles and revoked access', async t => {
  const root=mkdtempSync(join(tmpdir(),'oficina-tenants-'));
  const legacy=openDatabase(join(root,'original.sqlite'));
  const registry=openDatabase(join(root,'registry.sqlite'));
  migrate(legacy);
  createUser(legacy,{username:'rootuser',password:'StrongP@ss2026',role:'ADMIN',name:'Administrador'});
  createCustomer(legacy,{name:'Cliente somente matriz'});
  const server=createMultiTenantServer({registryDb:registry,legacyDb:legacy,tenantsRoot:join(root,'tenants'),legacyStorageDir:join(root,'uploads')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));registry.close();legacy.close();rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  let token='';
  async function request(method,path,body,unitId,auth=token){
    const headers={};
    if(auth)headers.Authorization='Bearer '+auth;
    if(unitId)headers['X-Oficina-Unit']=String(unitId);
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    let data;try{data=await response.json();}catch{data=null;}
    return {status:response.status,data};
  }
  const login=await request('POST','/api/auth/login',{username:'rootuser',password:'StrongP@ss2026'});
  assert.equal(login.status,200,JSON.stringify(login.data));
  token=login.data.token;
  const before=await request('GET','/api/customers');
  assert.equal(before.status,200);
  assert.equal(before.data[0].name,'Cliente somente matriz');
  const newCompany=await request('POST','/api/tenancy/companies',{slug:'filiais-2026',name:'Empresa B'});
  assert.equal(newCompany.status,201,JSON.stringify(newCompany.data));
  const second=newCompany.data.unitId;
  assert.equal((await request('GET','/api/customers')).status,409,'multiple memberships require explicit selection');
  const a=await request('GET','/api/customers',undefined,1);
  const b=await request('GET','/api/customers',undefined,second);
  assert.equal(a.data.length,1);
  assert.equal(b.data.length,0,'foreign tenant must see empty database');
  assert.equal((await request('POST','/api/customers',{name:'Cliente da empresa B'},second)).status,200);
  const aAgain=await request('GET','/api/customers',undefined,1);
  const bAgain=await request('GET','/api/customers',undefined,second);
  assert.deepEqual(aAgain.data.map(x=>x.name),['Cliente somente matriz']);
  assert.deepEqual(bAgain.data.map(x=>x.name),['Cliente da empresa B']);
  const sku=await request('POST','/api/parts',{sku:'PART-A-ONLY',description:'Componente exclusivo'},1);
  assert.equal(sku.status,200,JSON.stringify(sku.data));
  const partsOfB=await request('GET','/api/parts',undefined,second);
  assert.equal(partsOfB.status,200);
  assert.deepEqual(partsOfB.data,[],'inventory is physically isolated');
  const expense=await request('POST','/api/expenses',{description:'Despesa B',amountCents:5500},second);
  assert.equal(expense.status,200,JSON.stringify(expense.data));
  const expensesOfA=await request('GET','/api/expenses',undefined,1);
  assert.equal(expensesOfA.status,200);
  assert.deepEqual(expensesOfA.data,[],'financial entries must never cross companies');
  assert.equal((await request('GET','/api/health')).status,200,'health must remain public');
  const unit=await request('POST','/api/tenancy/units',{companyId:newCompany.data.id,code:'FILIAL',name:'Filial Norte'});
  assert.equal(unit.status,201,JSON.stringify(unit.data));
  const member=await request('POST','/api/tenancy/memberships',{unitId:unit.data.id,username:'technician',name:'Técnico Filial',password:'StrongP@ss2026',role:'TECNICO'});
  assert.equal(member.status,201,JSON.stringify(member.data));
  const staff=await request('POST','/api/auth/login',{username:'technician',password:'StrongP@ss2026'});
  assert.equal(staff.status,200);
  const staffToken=staff.data.token;
  assert.equal((await request('GET','/api/customers',undefined,unit.data.id,staffToken)).status,200);
  assert.equal((await request('GET','/api/customers',undefined,second,staffToken)).status,403);
  assert.equal((await request('POST','/api/customers',{name:'Forbidden'},unit.data.id,staffToken)).status,403);
  const revocation=await request('PATCH','/api/tenancy/memberships',{unitId:unit.data.id,userId:member.data.id,role:'TECNICO',active:false});
  assert.equal(revocation.status,200);
  assert.equal((await request('GET','/api/customers',undefined,unit.data.id,staffToken)).status,403);
  const audit=await request('GET','/api/tenancy/audit?companyId='+newCompany.data.id);
  assert.equal(audit.status,200,JSON.stringify(audit.data));
  assert.ok(audit.data.some(entry=>entry.action==='MEMBERSHIP_CHANGED'&&entry.target_user_id===member.data.id));
  assert.equal((await request('GET','/api/tenancy/audit?companyId='+newCompany.data.id,undefined,unit.data.id,staffToken)).status,403);
});
