import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer,createMachine,updateMachine,listMachines} from '../src/services/catalog.js';
import {createWorkOrder} from '../src/services/work-orders.js';
import {createServiceRecord,listServiceRecords} from '../src/services/vehicle-maintenance.js';

test('vehicle plate VIN and odometer are normalized and unique',()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);const c=createCustomer(db,{name:'Proprietário'});
  const v=createMachine(db,{customerId:c.id,type:'Carro',brand:'VW',model:'Gol',plate:'abc-1d23',vin:'9BWZZZ377VT004251',odometerKm:10520});
  assert.equal(v.license_plate,'ABC1D23');
  assert.equal(v.vin,'9BWZZZ377VT004251');
  assert.equal(v.odometer_km,10520);
  assert.equal(listMachines(db,{search:'ABC1D23'})[0].id,v.id);
  const updated=updateMachine(db,v.id,{odometerKm:10800});
  assert.equal(updated.odometer_km,10800);
  assert.throws(()=>updateMachine(db,v.id,{odometerKm:-1}),/Quilometragem/);
  assert.throws(()=>createMachine(db,{customerId:c.id,type:'Carro',plate:'abc1d23'}),/UNIQUE|placa/i);
  assert.throws(()=>createMachine(db,{customerId:c.id,type:'Carro',vin:'9BWZZZ377VT004251'}),/UNIQUE|chassi/i);
  assert.throws(()=>createMachine(db,{customerId:c.id,type:'Carro',vin:'123'}),/VIN|chassi/i);
 }finally{db.close()}
});

test('service and warranty records belong to vehicle and optionally to matching OS',()=>{
 const db=openDatabase(':memory:');
 try{
  migrate(db);
  const c=createCustomer(db,{name:'Cliente'}),d=createCustomer(db,{name:'Outro'});
  const v=createMachine(db,{customerId:c.id,type:'Carro',plate:'FGH2J34'});
  const other=createMachine(db,{customerId:d.id,type:'Carro',plate:'UVW1234'});
  const os=createWorkOrder(db,{customerId:c.id,machineId:v.id,problemReported:'Revisão preventiva'});
  const review=createServiceRecord(db,v.id,{kind:'REVISAO',workOrderId:os.id,performedAt:'2026-11-02',nextDueKm:20000,nextDueDate:'2027-05-01',notes:'Óleo e filtros'});
  assert.equal(review.kind,'REVISAO');
  const warranty=createServiceRecord(db,v.id,{kind:'GARANTIA',workOrderId:os.id,warrantyUntil:'2027-11-02',notes:'Garantia da mão de obra'});
  assert.equal(listServiceRecords(db,v.id).length,2);
  assert.equal(warranty.warranty_until,'2027-11-02');
  assert.throws(()=>createServiceRecord(db,other.id,{kind:'REVISAO',workOrderId:os.id}),/pertence|vínculo|veículo/i);
 }finally{db.close()}
});
