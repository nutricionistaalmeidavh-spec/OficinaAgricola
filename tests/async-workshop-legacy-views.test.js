import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
test('native legacy dashboard and operational report preserve visibility rules',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const s=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await s.createCustomer({name:'Cliente painel'});
  const m=await s.createMachine({customerId:c.id,type:'TRATOR'});
  await s.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Barulho'});
  const technician=await s.getDashboard({role:'TECNICO'});
  assert.equal(technician.counts.ENTRADA,1);
  assert.equal(technician.counts.ABERTAS,1);
  assert.equal('finance' in technician,false,'financial data never leaks through dashboard');
  const admin=await s.getDashboard({role:'ADMIN'});
  assert.ok(admin.finance);
  const report=await s.getOperationalReport({
   from:'2026-01-01T00:00:00.000Z',to:'2027-01-01T00:00:00.000Z',includeFinance:false
  });
  assert.equal(report.totalCount,1);
  assert.equal(report.finance,null);
 }finally{db.close();}
});
test('native legacy catalog and company settings expose existing API shapes',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const s=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await s.createCustomer({name:'Ana'});
  assert.equal((await s.getCustomer(c.id)).name,'Ana');
  const machine=await s.createMachine({customerId:c.id,type:'TRATOR'});
  assert.equal((await s.getMachine(machine.id)).id,machine.id);
  const saved=await s.updateCompanySettings({name:'Oficina Regional'});
  assert.equal(saved.name,'Oficina Regional');
  assert.equal((await s.getCompanySettings()).name,'Oficina Regional');
  const page=await s.listCustomersPage({limit:10});
  assert.equal(page.total,1);
  assert.equal(page.items[0].name,'Ana');
  const machines=await s.listMachinesPage({limit:10});
  assert.equal(machines.total,1);
  assert.equal(machines.items[0].id,machine.id);
 }finally{db.close();}
});


test('native legacy pagination always returns an items/total/nextCursor envelope',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const s=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  for(const method of ['listSchedulePage','listExpensesPage','listFiscalDocumentsPage','listSalesPage']){
   const page=await s[method]({limit:3});
   assert.ok(Array.isArray(page.items),method);
   assert.equal(page.total,0,method);
   assert.equal(page.nextCursor,null,method);
  }
  const technician=await s.createTechnician({name:'Maria'});
  const changed=await s.updateTechnician(technician.id,{name:'Maria Aparecida'});
  assert.equal(changed.name,'Maria Aparecida');
 }finally{db.close();}
});
