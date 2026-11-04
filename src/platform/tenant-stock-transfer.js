import { nowIso, transaction } from '../db.js';
import { postStockMovement } from '../services/inventory.js';
import { requireUnitMembership, requireCompanyReportingAdmin } from './tenant-registry.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const positiveId=value=>{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');
  return n;
};
const normalizeQuantity=value=>{
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0||n>1000000||Math.abs(n*1000-Math.round(n*1000))>1e-7)
    fail('Quantidade inválida: use valor positivo com até três casas decimais');
  return Math.round(n*1000)/1000;
};
function authorize(registryDb,actorUserId,sourceUnitId,targetUnitId){
  const source=requireUnitMembership(registryDb,actorUserId,positiveId(sourceUnitId));
  const target=requireUnitMembership(registryDb,actorUserId,positiveId(targetUnitId));
  if(source.companyId!==target.companyId)fail('Transferência entre empresas é proibida',403);
  if(source.id===target.id)fail('Origem e destino devem ser diferentes');
  if(source.role!=='ADMIN'||target.role!=='ADMIN')
    fail('Transferência requer ADMIN ativo nas duas unidades',403);
  return {source,target};
}
function ensureTable(db){
  db.exec(`CREATE TABLE IF NOT EXISTS tenant_stock_transfers(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES tenant_companies(id),
    source_unit_id INTEGER NOT NULL REFERENCES tenant_units(id),
    target_unit_id INTEGER NOT NULL REFERENCES tenant_units(id),
    source_part_id INTEGER NOT NULL,
    target_part_id INTEGER NOT NULL,
    quantity REAL NOT NULL CHECK(quantity>0),
    request_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETED')),
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(source_unit_id,request_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenant_stock_transfers_company ON tenant_stock_transfers(company_id,id DESC)');
}
function readTransfer(db,transferId){
  ensureTable(db);
  const row=db.prepare('SELECT * FROM tenant_stock_transfers WHERE id=?').get(positiveId(transferId));
  if(!row)fail('Transferência não encontrada',404);
  return row;
}
function markComplete(db,transfer,actorUserId){
  return transaction(db,()=>{
    const changed=db.prepare("UPDATE tenant_stock_transfers SET status='COMPLETED',completed_at=? WHERE id=? AND status='PENDING'")
      .run(nowIso(),transfer.id);
    if(changed.changes){
      db.prepare(`INSERT INTO tenant_audit(
        actor_user_id,action,company_id,unit_id,target_user_id,detail_json,created_at
      ) VALUES(?,'STOCK_TRANSFER_COMPLETED',?,?,NULL,?,?)`).run(
        actorUserId,transfer.company_id,transfer.target_unit_id,
        JSON.stringify({transferId:transfer.id,sourceUnitId:transfer.source_unit_id,
          targetUnitId:transfer.target_unit_id,sourcePartId:transfer.source_part_id,
          targetPartId:transfer.target_part_id,quantity:transfer.quantity}),nowIso()
      );
    }
  });
}
function result(transfer,created,status=transfer.status){
  return {transferId:transfer.id,status,created,
    sourceUnitId:transfer.source_unit_id,targetUnitId:transfer.target_unit_id,
    sourcePartId:transfer.source_part_id,targetPartId:transfer.target_part_id,quantity:transfer.quantity};
}
/**
 * Intent is durable in registry. Outbound debit and inbound credit each have
 * independent canonical ledger idempotency keys, both tied to the same intent.
 * If destination is temporarily unreachable, retry uses the SAME intent ID,
 * never debits the source twice, and exposes PENDING (stock in transit).
 * This is a local two-phase saga, not a distributed SQL transaction.
 */
function apply({registryDb,unitRuntime,actorUserId,transfer,created=false}){
  if(transfer.status==='COMPLETED')return result(transfer,false);
  let debited=false;
  const source=unitRuntime(transfer.source_unit_id).db;
  transaction(source,()=>{
    const existing=source.prepare(
      "SELECT id FROM inventory_movements WHERE source_type='TENANT_TRANSFER_OUT' AND source_item_id=?"
    ).get(transfer.id);
    if(!existing)postStockMovement(source,transfer.source_part_id,{
      type:'SAIDA_MANUAL',quantity:transfer.quantity,originType:'TENANT_TRANSFER_OUT',
      originItemId:transfer.id,note:'Transferência interna #'+transfer.id
    });
  });
  debited=true;
  try {
    const target=unitRuntime(transfer.target_unit_id).db;
    transaction(target,()=>{
      const existing=target.prepare(
        "SELECT id FROM inventory_movements WHERE source_type='TENANT_TRANSFER_IN' AND source_item_id=?"
      ).get(transfer.id);
      if(existing)return;
      const part=target.prepare('SELECT id FROM parts WHERE id=? AND active=1').get(transfer.target_part_id);
      if(!part)fail('Peça destino indisponível; estoque permanece em trânsito',409);
      postStockMovement(target,transfer.target_part_id,{
        type:'ENTRADA',quantity:transfer.quantity,originType:'TENANT_TRANSFER_IN',
        originItemId:transfer.id,note:'Recebimento transferência interna #'+transfer.id
      });
    });
    markComplete(registryDb,transfer,actorUserId);
    return result(transfer,created,'COMPLETED');
  }catch(error){
    if(!debited)throw error;
    // Source was already debited. Expose pending intent for manual replay;
    // never silently credit or refund because we cannot atomically know the
    // destination status after an interruption.
    return {...result(transfer,created,'PENDING'),message:'Estoque em trânsito: repita a transferência ou retome pelo ID'};
  }
}
export function transferTenantStock({
  registryDb,unitRuntime,actorUserId,sourceUnitId,targetUnitId,sourcePartId,
  targetPartId=null,quantity,requestId
}){
  const {source,target}=authorize(registryDb,actorUserId,sourceUnitId,targetUnitId);
  const q=normalizeQuantity(quantity),partId=positiveId(sourcePartId);
  const request=String(requestId||'').trim();
  if(request.length<3||request.length>128||!/^[A-Za-z0-9_.:-]+$/.test(request))
    fail('Identificador idempotente obrigatório (3 a 128 caracteres)');
  ensureTable(registryDb);
  let transfer=registryDb.prepare('SELECT * FROM tenant_stock_transfers WHERE source_unit_id=? AND request_id=?')
    .get(source.id,request);
  if(transfer){
    if(transfer.company_id!==source.companyId||transfer.target_unit_id!==target.id||
       transfer.source_part_id!==partId||transfer.quantity!==q||
       (targetPartId!=null&&transfer.target_part_id!==positiveId(targetPartId)))
      fail('Identificador já utilizado com dados de transferência diferentes',409);
    return apply({registryDb,unitRuntime,actorUserId,transfer,created:false});
  }
  const sourceDb=unitRuntime(source.id).db;
  const part=sourceDb.prepare('SELECT id,sku,unit,quantity FROM parts WHERE id=? AND active=1').get(partId);
  if(!part)fail('Peça origem não encontrada',404);
  const targetDb=unitRuntime(target.id).db;
  const desired=targetPartId==null?
    targetDb.prepare('SELECT id,sku,unit FROM parts WHERE sku=? AND active=1').get(part.sku):
    targetDb.prepare('SELECT id,sku,unit FROM parts WHERE id=? AND active=1').get(positiveId(targetPartId));
  if(!desired||desired.sku!==part.sku||desired.unit!==part.unit)
    fail('Cadastre a mesma peça na unidade destino antes de transferir estoque',409);
  if(Number(part.quantity)+1e-9<q)throw new Error('Estoque insuficiente');
  transfer=transaction(registryDb,()=>{
    const at=nowIso();
    const row=registryDb.prepare(`INSERT INTO tenant_stock_transfers(
      company_id,source_unit_id,target_unit_id,source_part_id,target_part_id,quantity,request_id,status,created_at
    ) VALUES(?,?,?,?,?,?,?,'PENDING',?)`).run(
      source.companyId,source.id,target.id,partId,desired.id,q,request,at
    );
    return readTransfer(registryDb,Number(row.lastInsertRowid));
  });
  return apply({registryDb,unitRuntime,actorUserId,transfer,created:true});
}
export function retryTenantStockTransfer({registryDb,unitRuntime,actorUserId,transferId}){
  const transfer=readTransfer(registryDb,transferId);
  authorize(registryDb,actorUserId,transfer.source_unit_id,transfer.target_unit_id);
  return apply({registryDb,unitRuntime,actorUserId,transfer,created:false});
}
export function listTenantStockTransfers({registryDb,actorUserId,companyId}){
  const id=positiveId(companyId);
  requireCompanyReportingAdmin(registryDb,actorUserId,id);
  ensureTable(registryDb);
  return registryDb.prepare(`SELECT id AS transferId,source_unit_id AS sourceUnitId,
    target_unit_id AS targetUnitId,source_part_id AS sourcePartId,
    target_part_id AS targetPartId,quantity,status,request_id AS requestId,
    created_at AS createdAt,completed_at AS completedAt
    FROM tenant_stock_transfers WHERE company_id=? ORDER BY id DESC LIMIT 100`).all(id);
}
