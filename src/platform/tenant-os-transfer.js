import {nowIso,transaction} from '../db.js';
import {createCustomer,createMachine} from '../services/catalog.js';
import {createWorkOrder,transitionWorkOrder} from '../services/work-orders.js';
import {requireUnitMembership} from './tenant-registry.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};
function authorize(db,actor,sourceUnitId,targetUnitId){
 const source=requireUnitMembership(db,actor,id(sourceUnitId));
 const target=requireUnitMembership(db,actor,id(targetUnitId));
 if(source.companyId!==target.companyId)fail('Transferência entre empresas proibida',403);
 if(source.id===target.id)fail('Selecione filiais diferentes');
 if(source.role!=='ADMIN'||target.role!=='ADMIN')
  fail('Transferência de OS exige ADMIN em ambas as unidades',403);
 return {source,target};
}
function ensureRegistry(db){
 db.exec(`CREATE TABLE IF NOT EXISTS tenant_order_transfers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES tenant_companies(id),
  source_unit_id INTEGER NOT NULL REFERENCES tenant_units(id),
  target_unit_id INTEGER NOT NULL REFERENCES tenant_units(id),
  source_work_order_id INTEGER NOT NULL,
  target_work_order_id INTEGER,
  legal_basis TEXT NOT NULL,
  record_reference TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETED')),
  created_at TEXT NOT NULL,completed_at TEXT,
  UNIQUE(source_unit_id,source_work_order_id),
  UNIQUE(source_unit_id,request_id)
 )`);
}
function ensureDestination(db){
 db.exec(`CREATE TABLE IF NOT EXISTS tenant_received_work_orders(
  company_id INTEGER NOT NULL,
  source_unit_id INTEGER NOT NULL,
  source_work_order_id INTEGER NOT NULL,
  local_work_order_id INTEGER NOT NULL UNIQUE REFERENCES work_orders(id),
  transferred_at TEXT NOT NULL,
  PRIMARY KEY(source_unit_id,source_work_order_id)
 )`);
}
function preflight(db,workOrderId){
 const row=db.prepare('SELECT * FROM work_orders WHERE id=?').get(id(workOrderId));
 if(!row)fail('Ordem de serviço não encontrada',404);
 if(!['ENTRADA','DIAGNOSTICO'].includes(row.status))
   fail('Somente OS em ENTRADA ou DIAGNOSTICO podem ser transferidas sem quebrar histórico financeiro',409);
 const tables=[
  ['quotes','work_order_id'],['work_order_parts','work_order_id'],
  ['receipts','work_order_id'],['expenses','work_order_id'],
  ['attachments','work_order_id'],['work_order_checklists','work_order_id'],
  ['schedule_events','work_order_id'],['vehicle_maintenance_records','work_order_id']
 ];
 for(const [table,column] of tables){
  if(db.prepare('SELECT 1 FROM '+table+' WHERE '+column+'=? LIMIT 1').get(row.id))
   fail('A OS possui vínculos financeiros, de serviço ou anexos; transferência integral exige reconciliação específica',409);
 }
 if(db.prepare("SELECT 1 FROM fiscal_documents WHERE origin_type='OS' AND origin_id=? LIMIT 1").get(row.id))
  fail('A OS possui documento fiscal e não pode ser transferida por cópia',409);
 return row;
}
function checkBasis(legalBasis,recordReference){
 if(!new Set(['CONTRATO','CONSENTIMENTO','LEGITIMO_INTERESSE','OBRIGACAO_LEGAL']).has(legalBasis))
  fail('Base legal inválida');
 if(typeof recordReference!=='string'||recordReference.trim().length<8||recordReference.length>120)
  fail('Informe referência auditável da transferência, de 8 a 120 caracteres');
}
function copyOperationalRecord(sourceDb,targetDb,os,transfer){
 ensureDestination(targetDb);
 const existing=targetDb.prepare('SELECT local_work_order_id FROM tenant_received_work_orders WHERE source_unit_id=? AND source_work_order_id=?')
   .get(transfer.source_unit_id,os.id);
 if(existing)return existing.local_work_order_id;
 return transaction(targetDb,()=>{
  const customer=sourceDb.prepare('SELECT * FROM customers WHERE id=?').get(os.customer_id);
  const machine=sourceDb.prepare('SELECT * FROM machines WHERE id=?').get(os.machine_id);
  if(!customer||!machine)fail('Dados de cliente ou veículo de origem inconsistentes',409);
  let targetCustomer=customer.document?
    targetDb.prepare('SELECT id FROM customers WHERE document=? AND active=1').get(customer.document):null;
  if(!targetCustomer){
    targetCustomer=createCustomer(targetDb,{
      name:customer.name,document:customer.document,phone:customer.phone,
      email:customer.email,address:customer.address,notes:''
    });
  }
  // Match only a vehicle already linked to the correct customer.
  let targetMachine=machine.vin?targetDb.prepare('SELECT id FROM machines WHERE customer_id=? AND vin=? AND active=1')
    .get(targetCustomer.id,machine.vin):null;
  if(!targetMachine){
    targetMachine=createMachine(targetDb,{
      customerId:targetCustomer.id,type:machine.type,brand:machine.brand,
      model:machine.model,year:machine.year,serialNumber:machine.serial_number,
      internalId:machine.internal_id,hourMeter:machine.hour_meter,
      plate:machine.license_plate,vin:machine.vin,
      odometerKm:machine.odometer_km,renavam:machine.renavam,
      engine:machine.engine,fuelType:machine.fuel_type,notes:''
    });
  }
  const transferred=createWorkOrder(targetDb,{
    customerId:targetCustomer.id,machineId:targetMachine.id,
    problemReported:os.problem_reported,diagnosis:os.diagnosis,
    priority:os.priority,enteredAt:os.entered_at,
    internalNotes:'Transferida da filial '+transfer.source_unit_id+' · OS origem #'+os.os_number,
    estimatedDelivery:os.estimated_delivery
  });
  if(os.status==='DIAGNOSTICO')
    transitionWorkOrder(targetDb,transferred.id,'DIAGNOSTICO',{
      reason:'Continuidade de diagnóstico após transferência interna'
    });
  targetDb.prepare(`INSERT INTO tenant_received_work_orders(
    company_id,source_unit_id,source_work_order_id,local_work_order_id,transferred_at
  ) VALUES(?,?,?,?,?)`).run(transfer.company_id,transfer.source_unit_id,os.id,transferred.id,nowIso());
  return transferred.id;
 });
}
function finish(registryDb,transfer,targetOsId,actorUserId){
 return transaction(registryDb,()=>{
  const updated=registryDb.prepare(`UPDATE tenant_order_transfers
    SET status='COMPLETED',target_work_order_id=?,completed_at=? WHERE id=? AND status='PENDING'`)
    .run(targetOsId,nowIso(),transfer.id);
  if(updated.changes){
    registryDb.prepare(`INSERT INTO tenant_audit(
      actor_user_id,action,company_id,unit_id,target_user_id,detail_json,created_at
    ) VALUES(?,'ORDER_TRANSFER_COMPLETED',?,?,NULL,?,?)`).run(
      actorUserId,transfer.company_id,transfer.target_unit_id,
      JSON.stringify({transferId:transfer.id,sourceUnitId:transfer.source_unit_id,
        targetUnitId:transfer.target_unit_id,workOrderId:transfer.source_work_order_id,
        targetWorkOrderId:targetOsId}),nowIso()
    );
  }
 });
}
function replay({registryDb,unitRuntime,actorUserId,transfer,created}){
 if(transfer.status==='COMPLETED')return {transferId:transfer.id,
   targetWorkOrderId:transfer.target_work_order_id,status:'COMPLETED',created:false};
 const sourceDb=unitRuntime(transfer.source_unit_id).db;
 const targetDb=unitRuntime(transfer.target_unit_id).db;
 const source=sourceDb.prepare('SELECT * FROM work_orders WHERE id=?').get(transfer.source_work_order_id);
 if(!source)fail('OS de origem não encontrada',404);
 let targetId=transfer.target_work_order_id;
 if(!targetId){
   ensureDestination(targetDb);
   const previous=targetDb.prepare('SELECT local_work_order_id FROM tenant_received_work_orders WHERE source_unit_id=? AND source_work_order_id=?')
     .get(transfer.source_unit_id,transfer.source_work_order_id);
   if(previous)targetId=previous.local_work_order_id;
   else targetId=copyOperationalRecord(sourceDb,targetDb,preflight(sourceDb,source.id),transfer);
 }
 if(source.status!=='CANCELADA'){
   preflight(sourceDb,source.id);
   transitionWorkOrder(sourceDb,source.id,'CANCELADA',{
     reason:'Transferência interna para unidade '+transfer.target_unit_id+'; OS destino #'+targetId
   });
 }
 finish(registryDb,transfer,targetId,actorUserId);
 return {transferId:transfer.id,targetWorkOrderId:targetId,status:'COMPLETED',created};
}
export function transferTenantWorkOrder({
 registryDb,unitRuntime,actorUserId,sourceUnitId,targetUnitId,workOrderId,legalBasis,recordReference,requestId
}){
 const {source,target}=authorize(registryDb,actorUserId,sourceUnitId,targetUnitId);
 checkBasis(legalBasis,recordReference);
 const osId=id(workOrderId),request=String(requestId||'').trim();
 if(!/^[A-Za-z0-9_.:-]{3,128}$/.test(request))fail('Identificador idempotente obrigatório');
 ensureRegistry(registryDb);
 let transfer=registryDb.prepare('SELECT * FROM tenant_order_transfers WHERE source_unit_id=? AND source_work_order_id=?')
   .get(source.id,osId);
 if(transfer){
   if(transfer.target_unit_id!==target.id||transfer.request_id!==request||
     transfer.legal_basis!==legalBasis||transfer.record_reference!==recordReference.trim())
     fail('OS já possui outra solicitação de transferência',409);
   return replay({registryDb,unitRuntime,actorUserId,transfer,created:false});
 }
 preflight(unitRuntime(source.id).db,osId);
 transfer=transaction(registryDb,()=>{
   const inserted=registryDb.prepare(`INSERT INTO tenant_order_transfers(
     company_id,source_unit_id,target_unit_id,source_work_order_id,legal_basis,
     record_reference,request_id,status,created_at
   ) VALUES(?,?,?,?,?,?,?,'PENDING',?)`).run(
     source.companyId,source.id,target.id,osId,legalBasis,recordReference.trim(),request,nowIso()
   );
   return registryDb.prepare('SELECT * FROM tenant_order_transfers WHERE id=?').get(Number(inserted.lastInsertRowid));
 });
 return replay({registryDb,unitRuntime,actorUserId,transfer,created:true});
}
export function retryTenantWorkOrderTransfer({registryDb,unitRuntime,actorUserId,transferId}){
 ensureRegistry(registryDb);
 const transfer=registryDb.prepare('SELECT * FROM tenant_order_transfers WHERE id=?').get(id(transferId));
 if(!transfer)fail('Transferência de OS não encontrada',404);
 authorize(registryDb,actorUserId,transfer.source_unit_id,transfer.target_unit_id);
 return replay({registryDb,unitRuntime,actorUserId,transfer,created:false});
}
