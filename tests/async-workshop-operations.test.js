import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

test('common adapter stores schedule and checklist completion atomically in local and native schema',async()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);migrateAssistencia(db);
  const service=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}));
  const customer=await service.createCustomer({name:'Cliente'});
  const machine=await service.createMachine({customerId:customer.id,type:'TRATOR'});
  const order=await service.createWorkOrder({customerId:customer.id,machineId:machine.id,problemReported:'Avaliação'});
  const event=await service.createScheduleEvent({
   type:'DIAGNOSTICO',title:'Diagnóstico',startsAt:'2026-11-05T09:00:00.000Z',
   endsAt:'2026-11-05T10:00:00.000Z',customerId:customer.id,machineId:machine.id,workOrderId:order.id
  });
  assert.equal((await service.listSchedule({from:'2026-11-05T00:00:00.000Z',to:'2026-11-06T00:00:00.000Z'})).length,1);
  assert.equal((await service.updateScheduleEvent(event.id,{title:'Diagnóstico revisado'})).title,'Diagnóstico revisado');
  await assert.rejects(service.createScheduleEvent({
   type:'DIAGNOSTICO',title:'Impossível',startsAt:'2026-11-05T10:00:00.000Z',
   endsAt:'2026-11-05T09:00:00.000Z'
  }),/anterior/);
  const template=await service.createChecklistTemplate({name:'Entrada',kind:'ENTRADA',items:[
   {label:'Foto',required:true},{label:'Combustível',required:false}
  ]});
  assert.equal(template.items.length,2);
  assert.equal((await service.listChecklistTemplates()).length,1);
  const saved=await service.createWorkOrderChecklist({
   workOrderId:order.id,templateId:template.id,
   responses:[{position:1,response:'OK'}]
  });
  assert.ok(saved.completed_at);
  assert.equal(saved.responses[0].label_snapshot,'Foto');
  const duplicate=await service.createWorkOrderChecklist({workOrderId:order.id,templateId:template.id,
   responses:[{position:1,response:'ATENCAO',note:'Repetida'},{position:1,response:'OK'}]});
  assert.fail('duplicate checklist accepted: '+duplicate.id);
 }catch(error){
  if(!/Resposta duplicada/.test(error.message))throw error;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM work_order_checklists').get().n,1,
    'invalid checklist must not leave a partial write');
 }finally{db.close();}
});
