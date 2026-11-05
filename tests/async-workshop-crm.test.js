import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('shared CRM, fleets and plate lookup are scoped to a single canonical database',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const c=await ws.createCustomer({name:'Transportes'});
  const m=await ws.createMachine({customerId:c.id,type:'AUTOMOVEL',brand:'VW',
   model:'Gol',plate:'ABC1D23'});
  assert.equal((await ws.lookupVehicleByPlate('ABC1D23')).id,m.id);
  const fleet=await ws.createFleet({customerId:c.id,name:'Frota testes'});
  await ws.addFleetVehicle(fleet.id,m.id);
  assert.equal((await ws.listFleets())[0].vehicle_count,1);
  const task=await ws.createCrmTask({
   customerId:c.id,machineId:m.id,title:'Ligar para cliente',
   dueAt:'2026-11-05',channel:'TELEFONE'
  });
  assert.equal((await ws.listCrmTasks({status:'PENDENTE'})).length,1);
  const done=await ws.completeCrmTask(task.id,{outcome:'Contatado'});
  assert.equal(done.status,'CONCLUIDA');
  assert.equal((await ws.listCrmTasks({status:'PENDENTE'})).length,0);
 }finally{db.close();}
});
test('shared CRM task rejects foreign vehicle ownership before writing',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const a=await ws.createCustomer({name:'Cliente A'});
  const b=await ws.createCustomer({name:'Cliente B'});
  const machine=await ws.createMachine({customerId:b.id,type:'AUTOMOVEL'});
  await assert.rejects(ws.createCrmTask({
   customerId:a.id,machineId:machine.id,title:'Invalida',
   dueAt:'2026-11-05',channel:'MANUAL'
  }),/não pertence/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_tasks').get().n,0);
 }finally{db.close();}
});
