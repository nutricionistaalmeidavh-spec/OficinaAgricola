import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer,createMachine,updateMachine} from '../src/services/catalog.js';
import {getCompanySettings,updateCompanySettings} from '../src/services/admin.js';
import {createPart} from '../src/services/inventory.js';
import {createWorkOrder} from '../src/services/work-orders.js';
import {savePartFitment,listCompatibleParts,createDiagnosticScan,listDiagnosticScans,
  createMaintenancePlan,listMaintenanceAlerts,completeMaintenancePlan,listMaintenancePlans} from '../src/services/automotive.js';
import {decodeDtcResponse} from '../src/services/obd.js';

function fixture(){
  const db=openDatabase(':memory:');migrate(db);
  const c=createCustomer(db,{name:'Cliente multimarcas'});
  const v=createMachine(db,{customerId:c.id,type:'Carro',brand:'Volkswagen',model:'Gol',year:2020,
    plate:'ABC1D23',renavam:'12345678901',engine:'1.6 MSI',fuelType:'FLEX',odometerKm:50000});
  return {db,c,v};
}
test('perfil da oficina é persistente e rejeita opção arbitrária',()=>{
  const db=openDatabase(':memory:');try{
    migrate(db);assert.equal(getCompanySettings(db).service_profile,'MISTA');
    assert.equal(updateCompanySettings(db,{serviceProfile:'AUTOMOTIVA'}).service_profile,'AUTOMOTIVA');
    assert.throws(()=>updateCompanySettings(db,{serviceProfile:'ADMIN'}),/perfil/i);
    assert.equal(getCompanySettings(db).service_profile,'AUTOMOTIVA');
  }finally{db.close()}
});
test('cadastro automotivo valida RENAVAM, motorização e combustível sem afetar horímetro',()=>{
  const {db,v}=fixture();try{
    assert.equal(v.renavam,'12345678901');assert.equal(v.engine,'1.6 MSI');assert.equal(v.fuel_type,'FLEX');
    assert.equal(updateMachine(db,v.id,{fuelType:'GASOLINA',odometerKm:51000}).renavam,'12345678901');
    assert.throws(()=>updateMachine(db,v.id,{renavam:'123'}),/RENAVAM/);
    assert.throws(()=>updateMachine(db,v.id,{fuelType:'INEXISTENTE'}),/Combustível/);
    const tr=createMachine(db,{customerId:v.customer_id,type:'Trator',hourMeter:600});
    assert.equal(tr.hour_meter,600);assert.equal(tr.renavam,null);
  }finally{db.close()}
});
test('compatibilidade só retorna peça com aplicação cadastrada e sem falso positivo',()=>{
  const {db,v}=fixture();try{
    const yes=createPart(db,{sku:'F-01',description:'Filtro VW'});
    const no=createPart(db,{sku:'F-02',description:'Filtro Ford'});
    const unknown=createPart(db,{sku:'F-03',description:'Sem aplicação'});
    savePartFitment(db,yes.id,{brand:'Volkswagen',model:'Gol',yearFrom:2018,yearTo:2022,engine:'1.6 MSI',fuelType:'FLEX'});
    savePartFitment(db,no.id,{brand:'Ford',model:'Ka',yearFrom:2018,yearTo:2022});
    const found=listCompatibleParts(db,v.id);
    assert.ok(found.some(p=>p.id===yes.id));
    assert.ok(!found.some(p=>p.id===no.id));
    assert.ok(!found.some(p=>p.id===unknown.id));
    assert.throws(()=>savePartFitment(db,yes.id,{brand:'VW',model:'Gol',yearFrom:2025,yearTo:2020}),/Ano/);
  }finally{db.close()}
});
test('OBD-II interpreta quadro hexadecimal modo 03 e rejeita resposta inválida',()=>{
  assert.deepEqual(decodeDtcResponse('SEARCHING...\r43 01 33 02 10 00 00\r>'),['P0133','P0210']);
  assert.deepEqual(decodeDtcResponse('43 00 00 00 00'),[]);
  assert.deepEqual(decodeDtcResponse('43 02 03 00 01 30',{can:true}),['P0300','P0130']);
  assert.deepEqual(decodeDtcResponse('43 01 33\n43 02 10'),['P0133','P0210']);
  assert.throws(()=>decodeDtcResponse('NO DATA'),/resposta|dados|DTC/i);
  assert.throws(()=>decodeDtcResponse('44 01 33'),/resposta|modo/i);
});
test('scan OBD-II só se vincula a OS do mesmo veículo, guarda códigos sem autorizar reparos',()=>{
  const {db,c,v}=fixture();try{
    const order=createWorkOrder(db,{customerId:c.id,machineId:v.id,problemReported:'Luz de injeção'});
    const saved=createDiagnosticScan(db,v.id,{workOrderId:order.id,rawResponse:'43 01 33 02 10',protocol:'ELM327 USB'});
    assert.deepEqual(JSON.parse(saved.codes_json),['P0133','P0210']);
    assert.equal(listDiagnosticScans(db,v.id).length,1);
    const other=createMachine(db,{customerId:c.id,type:'Carro',plate:'DEF1G23'});
    assert.throws(()=>createDiagnosticScan(db,other.id,{workOrderId:order.id,rawResponse:'43 01 33'}),/OS|veículo/i);
  }finally{db.close()}
});
test('planos de revisão geram alertas por data ou km/horas e avançam após execução',()=>{
  const {db,v,c}=fixture();try{
    const plan=createMaintenancePlan(db,v.id,{name:'Óleo e filtros',intervalKm:10000,intervalDays:180,
      startingKm:50000,startingDate:'2026-01-01'});
    const due=listMaintenanceAlerts(db,{today:'2026-07-01',kmAhead:1000,daysAhead:30});
    assert.ok(due.some(x=>x.id===plan.id&&x.status==='ATRASADO'));
    const os=createWorkOrder(db,{customerId:c.id,machineId:v.id,problemReported:'Revisão'});
    const done=completeMaintenancePlan(db,plan.id,{performedAt:'2026-07-01',odometerKm:51000,workOrderId:os.id});
    assert.equal(done.next_due_km,61000);
    assert.equal(done.next_due_date,'2026-12-28');
    assert.ok(!listMaintenanceAlerts(db,{today:'2026-07-01',kmAhead:1000,daysAhead:30}).some(x=>x.id===plan.id));
    assert.equal(listMaintenancePlans(db,v.id).length,1);
    assert.throws(()=>createMaintenancePlan(db,v.id,{name:'Vazio'}),/intervalo/i);
  }finally{db.close()}
});
