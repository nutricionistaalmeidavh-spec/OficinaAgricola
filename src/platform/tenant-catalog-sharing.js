import { nowIso, transaction } from '../db.js';
import { requireUnitMembership } from './tenant-registry.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};

/**
 * Explicit metadata-only catalog sharing. Stock quantities, movements, sales,
 * pricing history and customer details are NEVER transferred.
 * Both origin and destination must be actively administered by the actor.
 * Requests and successful results are recorded in the central audit registry.
 */
export function sharePartCatalog({registryDb,unitRuntime,actorUserId,sourceUnitId,targetUnitId,partId}){
  const source=requireUnitMembership(registryDb,actorUserId,id(sourceUnitId));
  const target=requireUnitMembership(registryDb,actorUserId,id(targetUnitId));
  if(source.companyId!==target.companyId)fail('Compartilhamento entre empresas é proibido',403);
  if(source.id===target.id)fail('Escolha unidades diferentes');
  if(source.role!=='ADMIN'||target.role!=='ADMIN')
    fail('Administração das duas unidades é necessária',403);
  const part=unitRuntime(source.id).db.prepare(
    'SELECT id,sku,description,category,unit,cost_cents,sale_price_cents,min_stock FROM parts WHERE id=? AND active=1'
  ).get(id(partId));
  if(!part)fail('Peça de origem não encontrada',404);
  const destination=unitRuntime(target.id).db;
  destination.exec(`CREATE TABLE IF NOT EXISTS tenant_shared_part_sources(
    company_id INTEGER NOT NULL,
    source_unit_id INTEGER NOT NULL,
    source_part_id INTEGER NOT NULL,
    target_part_id INTEGER NOT NULL REFERENCES parts(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(company_id,source_unit_id,source_part_id),
    UNIQUE(target_part_id)
  )`);
  const lookup=destination.prepare(
    'SELECT target_part_id FROM tenant_shared_part_sources WHERE company_id=? AND source_unit_id=? AND source_part_id=?'
  );
  const existing=lookup.get(source.companyId,source.id,part.id);
  if(existing)return {targetPartId:existing.target_part_id,created:false};
  // Do not overwrite a locally maintained part with coincidentally equal SKU.
  if(destination.prepare('SELECT 1 FROM parts WHERE sku=?').get(part.sku))
    fail('SKU já cadastrado na unidade de destino; nenhuma alteração foi feita',409);
  const audit=(action,detail)=>registryDb.prepare(
    'INSERT INTO tenant_audit(actor_user_id,action,company_id,unit_id,target_user_id,detail_json,created_at) VALUES(?,?,?,?,NULL,?,?)'
  ).run(actorUserId,action,source.companyId,target.id,JSON.stringify(detail),nowIso());
  const detail={sourceUnitId:source.id,targetUnitId:target.id,sourcePartId:part.id,sku:part.sku};
  audit('CATALOG_SHARE_REQUESTED',detail);
  const result=transaction(destination,()=>{
    // A new destination always starts with zero stock: no implicit inventory transfer.
    const now=nowIso();
    const inserted=destination.prepare(`INSERT INTO parts(
      sku,description,category,unit,cost_cents,sale_price_cents,
      quantity,min_stock,location,active,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,0,?,'',1,?,?)`).run(
      part.sku,part.description,part.category,part.unit,
      part.cost_cents,part.sale_price_cents,part.min_stock,now,now
    );
    const targetPartId=Number(inserted.lastInsertRowid);
    destination.prepare(
      'INSERT INTO tenant_shared_part_sources(company_id,source_unit_id,source_part_id,target_part_id,created_at) VALUES(?,?,?,?,?)'
    ).run(source.companyId,source.id,part.id,targetPartId,now);
    return {targetPartId,created:true};
  });
  audit('CATALOG_SHARE_COMPLETED',{...detail,targetPartId:result.targetPartId});
  return result;
}

/**
 * A controlled copy of the customer's minimum operational contact data.
 * No free-form notes, work orders, payment data or vehicle identifiers move.
 * Record reference and legal basis are mandatory for traceability; they do
 * not replace the operator's independent LGPD legal assessment.
 */
export function shareCustomer({registryDb,unitRuntime,actorUserId,sourceUnitId,targetUnitId,customerId,legalBasis,recordReference}){
  const source=requireUnitMembership(registryDb,actorUserId,id(sourceUnitId));
  const target=requireUnitMembership(registryDb,actorUserId,id(targetUnitId));
  if(source.companyId!==target.companyId)fail('Compartilhamento entre empresas é proibido',403);
  if(source.id===target.id)fail('Escolha unidades diferentes');
  if(source.role!=='ADMIN'||target.role!=='ADMIN')fail('Administração das duas unidades é necessária',403);
  const basis=String(legalBasis||'').trim();
  if(!new Set(['CONTRATO','LEGITIMO_INTERESSE','CONSENTIMENTO','OBRIGACAO_LEGAL']).has(basis))
    fail('Base legal inválida para o compartilhamento',400);
  const reference=String(recordReference||'').trim();
  if(reference.length<8||reference.length>120)fail('Informe uma referência verificável da finalidade (8 a 120 caracteres)',400);
  const customer=unitRuntime(source.id).db.prepare(
    'SELECT id,name,document,phone,email,address FROM customers WHERE id=? AND active=1'
  ).get(id(customerId));
  if(!customer)fail('Cliente de origem não encontrado',404);
  const destination=unitRuntime(target.id).db;
  destination.exec(`CREATE TABLE IF NOT EXISTS tenant_shared_customer_sources(
    company_id INTEGER NOT NULL,
    source_unit_id INTEGER NOT NULL,
    source_customer_id INTEGER NOT NULL,
    target_customer_id INTEGER NOT NULL REFERENCES customers(id),
    legal_basis TEXT NOT NULL,
    record_reference TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(company_id,source_unit_id,source_customer_id),
    UNIQUE(target_customer_id)
  )`);
  const previous=destination.prepare(
    'SELECT target_customer_id FROM tenant_shared_customer_sources WHERE company_id=? AND source_unit_id=? AND source_customer_id=?'
  ).get(source.companyId,source.id,customer.id);
  if(previous)return {targetCustomerId:previous.target_customer_id,created:false};
  if(customer.document && destination.prepare('SELECT id FROM customers WHERE document=? AND active=1').get(customer.document))
    fail('Documento já existe na unidade destino; revise duplicidade antes de compartilhar',409);
  const detail={sourceUnitId:source.id,targetUnitId:target.id,sourceCustomerId:customer.id,legalBasis:basis,recordReference:reference};
  const audit=(action,extra={})=>registryDb.prepare(
    'INSERT INTO tenant_audit(actor_user_id,action,company_id,unit_id,target_user_id,detail_json,created_at) VALUES(?,?,?,?,NULL,?,?)'
  ).run(actorUserId,action,source.companyId,target.id,JSON.stringify({...detail,...extra}),nowIso());
  audit('CUSTOMER_SHARE_REQUESTED');
  const result=transaction(destination,()=>{
    const now=nowIso();
    const created=destination.prepare(`INSERT INTO customers(
      name,document,phone,email,address,notes,active,created_at,updated_at
    ) VALUES(?,?,?,?,?,'',1,?,?)`).run(
      customer.name,customer.document,customer.phone,customer.email,customer.address,now,now
    );
    const targetCustomerId=Number(created.lastInsertRowid);
    destination.prepare(`INSERT INTO tenant_shared_customer_sources(
      company_id,source_unit_id,source_customer_id,target_customer_id,legal_basis,record_reference,created_at
    ) VALUES(?,?,?,?,?,?,?)`).run(
      source.companyId,source.id,customer.id,targetCustomerId,basis,reference,now
    );
    return {targetCustomerId,created:true};
  });
  audit('CUSTOMER_SHARE_COMPLETED',{targetCustomerId:result.targetCustomerId});
  return result;
}
