import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('common automotive services match fitment by model/year/fuel and isolate other vehicles',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await ws.createCustomer({name:'Cliente'});
  const m=await ws.createMachine({customerId:c.id,type:'AUTOMOVEL',brand:'Volkswagen',model:'Gol',
    year:2018,fuelType:'FLEX',engine:'1.6'});
  const other=await ws.createMachine({customerId:c.id,type:'AUTOMOVEL',brand:'Ford',model:'Fiesta',year:2018});
  const p=await ws.createPart({sku:'FIT-GOL',description:'Filtro Gol'});
  const fit=await ws.savePartFitment(p.id,{brand:'Volkswagen',model:'Gol',yearFrom:2016,
    yearTo:2021,fuelType:'FLEX',engine:'1.6'});
  assert.equal((await ws.listPartFitments(p.id)).length,1);
  assert.equal((await ws.listCompatibleParts(m.id))[0].id,p.id);
  assert.deepEqual(await ws.listCompatibleParts(other.id),[]);
  await ws.deletePartFitment(p.id,fit.id);
  assert.deepEqual(await ws.listCompatibleParts(m.id),[]);
 }finally{db.close();}
});
test('common preventive maintenance links only vehicle owned OS and books completion once',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await ws.createCustomer({name:'Cliente'});
  const m=await ws.createMachine({customerId:c.id,type:'AUTOMOVEL',model:'Gol'});
  const plan=await ws.createMaintenancePlan(m.id,{name:'Revisão',intervalDays:90,
    startingDate:'2026-08-01'});
  assert.equal(plan.next_due_date,'2026-10-30');
  assert.equal((await ws.listMaintenanceAlerts({today:'2026-11-04'})).length,1);
  const done=await ws.completeMaintenancePlan(plan.id,{performedAt:'2026-11-04'});
  assert.equal(done.last_completed_at,'2026-11-04');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM maintenance_plan_history').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vehicle_maintenance_records').get().n,1);
  assert.equal((await ws.listServiceRecords(m.id)).length,1);
  assert.equal((await ws.listMaintenancePlans(m.id)).length,1);
 }finally{db.close();}
});
