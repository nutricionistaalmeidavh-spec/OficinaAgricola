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

test('refuses unsafe conversion of legacy OS assigned to a second shop unit', () => {
  const original=openDatabase(':memory:'),registry=openDatabase(':memory:');
  try{
    migrate(original);
    original.prepare("INSERT INTO shop_units(code,name,created_at) VALUES('FILIAL','Filial','2026-11-03T00:00:00Z')").run();
    const id=createUser(original,{username:'manager',password:'StrongP@ss2026',role:'ADMIN',name:'Gerente'});
    const customer=createCustomer(original,{name:'Cliente filial'});
    const vehicle=original.prepare("INSERT INTO machines(customer_id,type,created_at,updated_at) VALUES(?,'AUTOMOVEL','2026-11-03','2026-11-03')").run(customer.id).lastInsertRowid;
    original.prepare("INSERT INTO work_orders(os_number,customer_id,machine_id,entered_at,problem_reported,snapshot_customer,snapshot_machine,unit_id,created_at,updated_at) VALUES(1,?,?,'2026-11-03','Falha','{}','{}',2,'2026-11-03','2026-11-03')").run(customer.id,vehicle);
    assert.throws(()=>createMultiTenantServer({legacyDb:original,registryDb:registry}),/Migração segura das OS/);
    assert.equal(original.prepare('SELECT COUNT(*) n FROM work_orders').get().n,1,'legacy OS must not be modified');
    assert.equal(original.prepare('SELECT id FROM users WHERE id=?').get(id).id,id);
  }finally{original.close();registry.close();}
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
  const companySummary=await request('GET','/api/tenancy/company-summary?companyId='+newCompany.data.id);
  assert.equal(companySummary.status,200,JSON.stringify(companySummary.data));
  assert.equal(companySummary.data.totals.customers,1,'company reports must only include their units');
  assert.equal(companySummary.data.units.length,1);
  assert.equal((await request('GET','/api/tenancy/company-summary?companyId=999')).status,403);
  const vehicle=await request('POST','/api/machines',{customerId:aAgain.data[0].id,type:'AUTOMOVEL',brand:'Volkswagen'},1);
  assert.equal(vehicle.status,200,JSON.stringify(vehicle.data));
  const order=await request('POST','/api/work-orders',{customerId:aAgain.data[0].id,machineId:vehicle.data.id,problemReported:'Revisão'},1);
  assert.equal(order.status,200,JSON.stringify(order.data));
  assert.equal(order.data.unit_id,1,'an OS is assigned to its local unit at creation');
  const foreignOrders=await request('GET','/api/work-orders',undefined,second);
  assert.equal(foreignOrders.status,200);
  assert.deepEqual(foreignOrders.data,[],'OS records never cross units');
  const sku=await request('POST','/api/parts',{sku:'PART-A-ONLY',description:'Componente exclusivo'},1);
  assert.equal(sku.status,200,JSON.stringify(sku.data));
  assert.equal((await request('POST','/api/fiscal/1/submit',{},second)).status,409,'fiscal provider must be isolated per company');
  const partsOfB=await request('GET','/api/parts',undefined,second);
  assert.equal(partsOfB.status,200);
  assert.deepEqual(partsOfB.data,[],'inventory is physically isolated');
  const expense=await request('POST','/api/expenses',{description:'Despesa B',amountCents:5500,paidAt:'2026-11-03T12:00:00.000Z'},second);
  assert.equal(expense.status,200,JSON.stringify(expense.data));
  const expensesOfA=await request('GET','/api/expenses',undefined,1);
  assert.equal(expensesOfA.status,200);
  assert.deepEqual(expensesOfA.data,[],'financial entries must never cross companies');
  assert.equal((await request('GET','/api/health')).status,200,'health must remain public');
  const unit=await request('POST','/api/tenancy/units',{companyId:newCompany.data.id,code:'FILIAL',name:'Filial Norte'});
  assert.equal(unit.status,201,JSON.stringify(unit.data));
  // Shared catalog is explicit and audited, never a silent stock transfer.
  const sharedSource=await request('POST','/api/parts',{sku:'SHARED-001',description:'Peça compartilhada',quantity:8,salePriceCents:6000},second);
  assert.equal(sharedSource.status,200,JSON.stringify(sharedSource.data));
  assert.equal((await request('POST','/api/tenancy/share-part',{sourceUnitId:1,targetUnitId:second,partId:sku.data.id})).status,403,'cross-company sharing forbidden');
  const shared=await request('POST','/api/tenancy/share-part',{sourceUnitId:second,targetUnitId:unit.data.id,partId:sharedSource.data.id});
  assert.equal(shared.status,200,JSON.stringify(shared.data));
  assert.equal(shared.data.created,true);
  const targetPart=await request('GET','/api/parts',undefined,unit.data.id);
  assert.equal(targetPart.data.length,1);
  assert.equal(targetPart.data[0].sku,'SHARED-001');
  assert.equal(targetPart.data[0].quantity,0,'catalog copy must not manufacture physical stock');
  const repeat=await request('POST','/api/tenancy/share-part',{sourceUnitId:second,targetUnitId:unit.data.id,partId:sharedSource.data.id});
  assert.equal(repeat.status,200);
  assert.equal(repeat.data.targetPartId,shared.data.targetPartId,'retries do not duplicate catalog entries');
  assert.equal(repeat.data.created,false);
  // Customer sharing is opt-in and purpose-bound, with a legal basis reference.
  const shareCustomerBody={sourceUnitId:second,targetUnitId:unit.data.id,customerId:bAgain.data[0].id,legalBasis:'CONTRATO',recordReference:'OS-COMPARTILHADA-2026-001'};
  assert.equal((await request('POST','/api/tenancy/share-customer',{...shareCustomerBody,recordReference:''})).status,400,'evidence reference required');
  assert.equal((await request('POST','/api/tenancy/share-customer',{...shareCustomerBody,targetUnitId:1})).status,403,'company boundaries cannot be crossed');
  const copiedCustomer=await request('POST','/api/tenancy/share-customer',shareCustomerBody);
  assert.equal(copiedCustomer.status,200,JSON.stringify(copiedCustomer.data));
  assert.equal(copiedCustomer.data.created,true);
  const customerCopy=await request('GET','/api/customers',undefined,unit.data.id);
  assert.equal(customerCopy.data.length,1);
  assert.equal(customerCopy.data[0].name,'Cliente da empresa B');
  assert.equal(customerCopy.data[0].notes,'','free-form private notes must never be shared');
  const sameCustomer=await request('POST','/api/tenancy/share-customer',shareCustomerBody);
  assert.equal(sameCustomer.status,200);
  assert.equal(sameCustomer.data.created,false);
  assert.equal(sameCustomer.data.targetCustomerId,copiedCustomer.data.targetCustomerId);
  const member=await request('POST','/api/tenancy/memberships',{unitId:unit.data.id,username:'technician',name:'Técnico Filial',password:'StrongP@ss2026',role:'TECNICO'});
  assert.equal(member.status,201,JSON.stringify(member.data));
  const staff=await request('POST','/api/auth/login',{username:'technician',password:'StrongP@ss2026'});
  assert.equal(staff.status,200);
  const staffToken=staff.data.token;
  assert.equal((await request('GET','/api/customers',undefined,unit.data.id,staffToken)).status,200);
  assert.equal((await request('GET','/api/customers',undefined,second,staffToken)).status,403);
  assert.equal((await request('POST','/api/customers',{name:'Forbidden'},unit.data.id,staffToken)).status,403);
  assert.equal((await request('GET','/api/tenancy/shareable-parts?unitId='+unit.data.id,undefined,unit.data.id,staffToken)).status,403);
  assert.equal((await request('GET','/api/tenancy/shareable-customers?unitId='+unit.data.id,undefined,unit.data.id,staffToken)).status,403);
  assert.equal((await request('POST','/api/tenancy/share-part',{sourceUnitId:second,targetUnitId:unit.data.id,partId:sharedSource.data.id},unit.data.id,staffToken)).status,403);
  const revocation=await request('PATCH','/api/tenancy/memberships',{unitId:unit.data.id,userId:member.data.id,role:'TECNICO',active:false});
  assert.equal(revocation.status,200);
  assert.equal((await request('GET','/api/customers',undefined,unit.data.id,staffToken)).status,403);
  // Financial consolidation must use canonical payment events and paid expenses,
  // never mixing independent companies or duplicating a receipt as revenue.
  const consolidated=await request('GET','/api/tenancy/company-summary?companyId='+newCompany.data.id+'&from=2026-01-01T00%3A00%3A00.000Z&to=2027-12-31T23%3A59%3A59.999Z');
  assert.equal(consolidated.status,200,JSON.stringify(consolidated.data));
  assert.equal(consolidated.data.totals.finance.expensesCents,5500);
  assert.equal(consolidated.data.totals.finance.receivedCents,0);
  assert.equal(consolidated.data.totals.finance.resultCents,-5500);
  assert.equal(consolidated.data.units.find(x=>x.id===unit.data.id).finance.expensesCents,0);
  const otherConsolidated=await request('GET','/api/tenancy/company-summary?companyId=1');
  assert.equal(otherConsolidated.status,200);
  assert.equal(otherConsolidated.data.totals.finance.expensesCents,0,'other company expense must never be included');
  assert.equal((await request('GET','/api/tenancy/company-summary?companyId='+newCompany.data.id+'&from=invalid')).status,400);
  const audit=await request('GET','/api/tenancy/audit?companyId='+newCompany.data.id);
  assert.equal(audit.status,200,JSON.stringify(audit.data));
  assert.ok(audit.data.some(entry=>entry.action==='MEMBERSHIP_CHANGED'&&entry.target_user_id===member.data.id));
  assert.ok(audit.data.some(entry=>entry.action==='CATALOG_SHARE_COMPLETED'),'catalog shares must be auditable');
  assert.ok(audit.data.some(entry=>entry.action==='CUSTOMER_SHARE_COMPLETED'),'customer sharing must be auditable');
  assert.equal((await request('GET','/api/tenancy/audit?companyId='+newCompany.data.id,undefined,unit.data.id,staffToken)).status,403);
});
