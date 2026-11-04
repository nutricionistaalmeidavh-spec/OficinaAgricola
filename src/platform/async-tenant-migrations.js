import {ADDITIONAL_TENANT_TABLES,ADDITIONAL_TENANT_INDEXES} from './async-tenant-extra-schema.js';
// Canonical async relational schema for future Postgres / Cloudflare D1
// operational backends. Existing SQLite remains the enabled runtime until
// the full service graph is migrated and parity-tested. No implicit fallback.
const TABLES=[
`CREATE TABLE IF NOT EXISTS async_schema_migrations(
  version TEXT PRIMARY KEY,applied_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS async_tenant_identity(
  id INTEGER PRIMARY KEY CHECK(id=1),
  company_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  assigned_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,document TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS machines(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL,brand TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '',
  year INTEGER,serial_number TEXT NOT NULL DEFAULT '',internal_id TEXT NOT NULL DEFAULT '',
  hour_meter REAL NOT NULL DEFAULT 0 CHECK(hour_meter>=0),
  license_plate TEXT,vin TEXT,odometer_km REAL,renavam TEXT,
  engine TEXT NOT NULL DEFAULT '',fuel_type TEXT,
  notes TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS work_orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  os_number INTEGER NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  entered_at TEXT NOT NULL,problem_reported TEXT NOT NULL,
  diagnosis TEXT NOT NULL DEFAULT '',technician_id INTEGER,
  estimated_delivery TEXT,priority TEXT NOT NULL DEFAULT 'NORMAL',
  internal_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ENTRADA',
  completed_at TEXT,delivered_at TEXT,
  snapshot_customer TEXT NOT NULL,snapshot_machine TEXT NOT NULL,
  quote_total_cents INTEGER NOT NULL DEFAULT 0,
  unit_id INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS work_order_status_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  from_status TEXT,to_status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',
  changed_by INTEGER,changed_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS work_order_change_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  field TEXT NOT NULL,old_value TEXT,new_value TEXT,
  changed_by INTEGER,changed_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS quotes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL UNIQUE REFERENCES work_orders(id),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',valid_until TEXT,
  approval_status TEXT NOT NULL DEFAULT 'RASCUNHO',
  rejection_reason TEXT NOT NULL DEFAULT '',
  approved_at TEXT,rejected_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS quote_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  kind TEXT NOT NULL,description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity>=0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
  total_cents INTEGER NOT NULL CHECK(total_cents>=0)
)`,
`CREATE TABLE IF NOT EXISTS parts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT 'UN',
  cost_cents INTEGER NOT NULL DEFAULT 0,sale_price_cents INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,min_stock REAL NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS inventory_movements(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  type TEXT NOT NULL,quantity_delta REAL NOT NULL,
  work_order_id INTEGER REFERENCES work_orders(id),
  note TEXT NOT NULL DEFAULT '',created_by INTEGER,
  created_at TEXT NOT NULL,source_type TEXT,source_item_id INTEGER,
  UNIQUE(source_type,source_item_id)
)`,
`CREATE TABLE IF NOT EXISTS work_order_parts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity REAL NOT NULL CHECK(quantity>0),
  unit_price_cents INTEGER NOT NULL,
  movement_id INTEGER NOT NULL REFERENCES inventory_movements(id),
  reversed_at TEXT
)`,
`CREATE TABLE IF NOT EXISTS receipts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL,
  received_at TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',
  created_by INTEGER,reversed_at TEXT,reversal_note TEXT NOT NULL DEFAULT '',
  request_id TEXT UNIQUE,request_payload_hash TEXT
)`,
`CREATE TABLE IF NOT EXISTS payment_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,source_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents<>0),
  method TEXT NOT NULL,cash_session_id INTEGER,created_at TEXT NOT NULL,
  UNIQUE(source_type,source_id,event_type)
)`,
`CREATE TABLE IF NOT EXISTS expenses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  due_date TEXT,paid_at TEXT,reference_center TEXT NOT NULL DEFAULT '',
  work_order_id INTEGER REFERENCES work_orders(id),note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS attachments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  category TEXT NOT NULL,caption TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL,original_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS fiscal_documents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,origin_type TEXT NOT NULL,
  origin_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'RASCUNHO',
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
  issuer_snapshot_json TEXT,request_id TEXT NOT NULL UNIQUE,
  provider_name TEXT NOT NULL DEFAULT '',attempt_id TEXT,
  access_key TEXT,protocol TEXT,fiscal_number TEXT,fiscal_series TEXT,
  authorized_xml TEXT,response_json TEXT,last_error TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,authorized_at TEXT,
  UNIQUE(kind,origin_type,origin_id)
)`,
`CREATE TABLE IF NOT EXISTS fiscal_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES fiscal_documents(id),
  event_type TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS domain_outbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT UNIQUE,event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,payload_json TEXT NOT NULL,
  meta_json TEXT,created_at TEXT NOT NULL,delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at TEXT
)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_async_receipts_request
 ON receipts(request_id)`,
`CREATE INDEX IF NOT EXISTS idx_async_work_orders_status
 ON work_orders(status,id)`,
`CREATE INDEX IF NOT EXISTS idx_async_work_orders_customer
 ON work_orders(customer_id,id)`,
`CREATE INDEX IF NOT EXISTS idx_async_receipts_os ON receipts(work_order_id)`,
`CREATE INDEX IF NOT EXISTS idx_async_inventory_part
 ON inventory_movements(part_id,id)`,
`CREATE INDEX IF NOT EXISTS idx_async_fiscal_status
 ON fiscal_documents(status,id)`,
`CREATE INDEX IF NOT EXISTS idx_async_outbox_pending
 ON domain_outbox(delivered_at,id)`
];
const VERSION='2026-11-04-async-canonical-initial';
export function asyncTenantSchema(engine){
 if(!['postgres','d1'].includes(engine))
   throw Error('Engine SQL assíncrono inválido');
 const statements=[...TABLES,...ADDITIONAL_TENANT_TABLES].map(sql=>{
   if(engine!=='postgres')return sql;
   // Runtime-issued 48-bit IDs and monetary cent amounts exceed PostgreSQL
   // INT4. Keep every FK and canonical monetary column as BIGINT.
   return sql.replaceAll('INTEGER PRIMARY KEY AUTOINCREMENT',
     'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
     .replace(/\b([a-z][a-z0-9_]*_id|created_by|changed_by)\s+INTEGER\b/g,'$1 BIGINT')
     .replace(/\b([a-z][a-z0-9_]*_cents)\s+INTEGER\b/g,'$1 BIGINT')
     .replace(/\bos_number INTEGER\b/g,'os_number BIGINT')
     .replace(/\bsale_number INTEGER\b/g,'sale_number BIGINT')
     .replace(/\b(opened_by) INTEGER\b/g,'$1 BIGINT')
     .replace(/\bCOLLATE NOCASE\b/gi,'');
 });
 // Create lookup/uniqueness indexes only AFTER all business tables exist.
 for(const index of ADDITIONAL_TENANT_INDEXES)
   statements.push(engine==='postgres'?index.replace(/\bCOLLATE NOCASE\b/gi,''):index);
 // PostgreSQL MAX(os_number)+1 is unsafe under parallel transactions:
 // separate connections can compute the same number before either commits.
 // Sequence numbers are unique even on rollback; gaps are acceptable.
 if(engine==='postgres'){
   statements.push('CREATE SEQUENCE IF NOT EXISTS async_os_number_seq AS BIGINT');
   statements.push('CREATE SEQUENCE IF NOT EXISTS async_sale_number_seq AS BIGINT');
 }
 return statements;
}
export async function migrateAsyncTenantStore(port,{seed=true}={}){
 if(!port||!['postgres','d1'].includes(port.engine))
   throw Error('Migrate exige PostgreSQL ou Cloudflare D1 real');
 const ddl=asyncTenantSchema(port.engine);
 const now=new Date().toISOString();
 const record={sql:'INSERT INTO async_schema_migrations(version,applied_at) VALUES(?,?) ON CONFLICT(version) DO NOTHING',
   params:[VERSION,now]};
 if(typeof seed!=='boolean')throw Error('Opção seed deve ser explícita e booleana');
 const seeds=[
   {sql:`INSERT INTO company_settings(id,updated_at) VALUES(1,?)
     ON CONFLICT(id) DO NOTHING`,params:[now]},
   {sql:`INSERT INTO shop_units(id,code,name,created_at)
     VALUES(1,'MATRIZ','Matriz',?) ON CONFLICT(id) DO NOTHING`,params:[now]},
   {sql:`INSERT INTO fiscal_settings(id,updated_at) VALUES(1,?)
     ON CONFLICT(id) DO NOTHING`,params:[now]}
 ];
 if(port.engine==='d1'){
   // Cloudflare D1's batch executes atomically. Never use a fake
   // interactive BEGIN/COMMIT sequence on the D1 binding.
   await port.batch([...ddl.map(sql=>({sql,params:[]})),...(seed?seeds:[]),record]);
 }else{
   await port.transaction(async tx=>{
     for(const sql of ddl)await tx.run(sql);
     if(seed)for(const item of seeds)await tx.run(item.sql,item.params);
     await tx.run(record.sql,record.params);
   });
 }
 return {engine:port.engine,version:VERSION,tables:ddl.length};
}

/**
 * Operational DB is permanently bound to one company/unit.
 * Every backend bootstrap must claim the binding before serving requests.
 * This prevents accidental reuse of a D1 binding or PostgreSQL database by
 * different tenants. Never silently change its owner.
 */
export async function claimAsyncTenantIdentity(port,{companyId,unitId}={}){
 if(!port||!['postgres','d1'].includes(port.engine))throw Error('Backend SQL inválido');
 const company=Number(companyId),unit=Number(unitId);
 if(!Number.isSafeInteger(company)||company<1||!Number.isSafeInteger(unit)||unit<1)
   throw Error('Empresa e unidade obrigatórias para backend assíncrono');
 const at=new Date().toISOString();
 await port.run(`INSERT INTO async_tenant_identity(id,company_id,unit_id,assigned_at)
   VALUES(1,?,?,?) ON CONFLICT(id) DO NOTHING`,[company,unit,at]);
 const current=await port.first('SELECT company_id,unit_id FROM async_tenant_identity WHERE id=1');
 if(!current||Number(current.company_id)!==company||Number(current.unit_id)!==unit)
   throw Error('Banco já pertence a outro tenant; operação bloqueada sem migração auditada');
 return {companyId:company,unitId:unit};
}

export async function assertAsyncTenantIdentity(port,{companyId,unitId}={}){
 const company=Number(companyId),unit=Number(unitId);
 if(!Number.isSafeInteger(company)||company<1||!Number.isSafeInteger(unit)||unit<1)
   throw Error('Empresa/unidade SQL não configuradas');
 const actual=await port.first('SELECT company_id,unit_id FROM async_tenant_identity WHERE id=1');
 if(!actual||Number(actual.company_id)!==company||Number(actual.unit_id)!==unit)
   throw Error('Banco associado a outro tenant ou não inicializado');
 return {companyId:company,unitId:unit};
}
