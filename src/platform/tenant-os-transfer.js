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
  source_version INTEGER,
  UNIQUE(source_unit_id,source_work_order_id),
  UNIQUE(source_unit_id,request_id)
 )`);
 const columns=new Set(db.prepare("PRAGMA table_info('tenant_order_transfers')").all().map(c=>c.name));
 if(!columns.has('source_version'))
   db.exec('ALTER TABLE tenant_order_transfers ADD COLUMN source_version INTEGER');
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
 // Financial ledgers, stock movements, fiscal documents and attachments
 // remain legally authoritative in the source company/unit. The receiving
 // unit gets an operational continuation with a linked, auditable dossier.
 if(['ENTREGUE','CANCELADA','TRANSFERIDA'].includes(row.status))
   fail('OS encerrada não pode iniciar nova transferência',409);
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
 if(source.status!=='TRANSFERIDA'&&source.status!=='CANCELADA'){
   transaction(sourceDb,()=>{
     const current=preflight(sourceDb,source.id);
     if(transfer.source_version!=null&&Number(current.version)!==Number(transfer.source_version))
       fail('OS alterada após início da transferência; reconciliação manual necessária',409);
     const timestamp=nowIso();
     const change=sourceDb.prepare(`UPDATE work_orders SET status='TRANSFERIDA',
       version=version+1,updated_at=? WHERE id=? AND version=? AND status=?`)
       .run(timestamp,current.id,current.version,current.status);
     if(change.changes!==1)fail('OS alterada concorrentemente durante transferência',409);
     // NEVER run the cancellation transition: that hides outstanding
     // receivables and may reverse canonical financial semantics.
     sourceDb.prepare(`INSERT INTO work_order_status_history(
       work_order_id,from_status,to_status,reason,changed_by,changed_at
     ) VALUES(? ,?,'TRANSFERIDA',?,NULL,?)`).run(
       current.id,current.status,
       'Continuidade na unidade '+transfer.target_unit_id+', OS #'+targetId+'. Histórico financeiro/fiscal preservado na origem.',timestamp
     );
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
 const sourceOrder=preflight(unitRuntime(source.id).db,osId);
 transfer=transaction(registryDb,()=>{
   const inserted=registryDb.prepare(`INSERT INTO tenant_order_transfers(
     company_id,source_unit_id,target_unit_id,source_work_order_id,legal_basis,
     record_reference,request_id,status,created_at,source_version
   ) VALUES(?,?,?,?,?,?,?,'PENDING',?,?)`).run(
     source.companyId,source.id,target.id,osId,legalBasis,recordReference.trim(),request,nowIso(),sourceOrder.version
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


/**
 * Read-only dossier: the source unit remains the ONLY owner of existing
 * receipts, cash, inventory movements, approved quotes and fiscal XML.
 * Never duplicate a fiscal invoice or a payment to another unit's ledger.
 * Require the actor to administer BOTH units for purpose-bound access.
 */
export function getTenantTransferDossier({registryDb,unitRuntime,actorUserId,transferId}){
 ensureRegistry(registryDb);
 const transfer=registryDb.prepare('SELECT * FROM tenant_order_transfers WHERE id=?')
   .get(id(transferId));
 if(!transfer)fail('Transferência não encontrada',404);
 authorize(registryDb,actorUserId,transfer.source_unit_id,transfer.target_unit_id);
 const db=unitRuntime(transfer.source_unit_id).db,osId=transfer.source_work_order_id;
 const sourceOrder=db.prepare('SELECT * FROM work_orders WHERE id=?').get(osId);
 if(!sourceOrder)fail('OS origem não encontrada',404);
 const quote=db.prepare('SELECT * FROM quotes WHERE work_order_id=?').get(osId)||null;
 const quoteItems=quote?db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id').all(quote.id):[];
 const receipts=db.prepare('SELECT * FROM receipts WHERE work_order_id=? ORDER BY id').all(osId);
 const paymentEvents=db.prepare(`SELECT p.* FROM payment_events p
   JOIN receipts r ON p.source_type='OS_RECEIPT' AND p.source_id=r.id
   WHERE r.work_order_id=? ORDER BY p.id`).all(osId);
 const stockConsumptions=db.prepare(`SELECT wp.*,p.sku,p.description
   FROM work_order_parts wp JOIN parts p ON p.id=wp.part_id
   WHERE wp.work_order_id=? ORDER BY wp.id`).all(osId);
 const stockMovements=db.prepare(`SELECT * FROM inventory_movements
   WHERE work_order_id=? ORDER BY id`).all(osId);
 const expenses=db.prepare('SELECT * FROM expenses WHERE work_order_id=? ORDER BY id').all(osId);
 const fiscalDocuments=db.prepare(`SELECT id,kind,origin_type,origin_id,status,
   environment,amount_cents,request_id,access_key,protocol,fiscal_number,
   fiscal_series,created_at,authorized_at FROM fiscal_documents
   WHERE origin_type='OS' AND origin_id=? ORDER BY id`).all(osId);
 const attachments=db.prepare(`SELECT id,work_order_id,category,caption,
   mime_type,original_name,size_bytes,created_at FROM attachments
   WHERE work_order_id=? ORDER BY id`).all(osId);
 const checklistRows=db.prepare('SELECT * FROM work_order_checklists WHERE work_order_id=? ORDER BY id').all(osId);
 const checklists=checklistRows.map(row=>({...row,responses:db.prepare(
   'SELECT * FROM checklist_responses WHERE checklist_id=? ORDER BY position').all(row.id)}));
 const schedule=db.prepare('SELECT * FROM schedule_events WHERE work_order_id=? ORDER BY id').all(osId);
 const maintenance=db.prepare('SELECT * FROM vehicle_maintenance_records WHERE work_order_id=? ORDER BY id').all(osId);
 const statusHistory=db.prepare('SELECT * FROM work_order_status_history WHERE work_order_id=? ORDER BY id').all(osId);
 const changeHistory=db.prepare('SELECT * FROM work_order_change_history WHERE work_order_id=? ORDER BY id').all(osId);
 return {
   transferId:transfer.id,status:transfer.status,companyId:transfer.company_id,
   originUnitId:transfer.source_unit_id,targetUnitId:transfer.target_unit_id,
   sourceWorkOrderId:osId,targetWorkOrderId:transfer.target_work_order_id,
   legalBasis:transfer.legal_basis,recordReference:transfer.record_reference,
   authoritativeLedgers:'ORIGIN',
   sourceOrder,quote,quoteItems,receipts,paymentEvents,stockConsumptions,stockMovements,
   expenses,fiscalDocuments,attachments,checklists,schedule,maintenance,statusHistory,changeHistory
 };
}
