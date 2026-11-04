import { DatabaseSync } from 'node:sqlite';
import { migrateFiscal } from './fiscal-schema.js';
import { migrateMarketParity } from './services/market-parity.js';
import {migrateLocalPaymentCollection} from './platform/payment-collection.js';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const nowIso = () => new Date().toISOString();

export function openDatabase(path = process.env.DATABASE_PATH || './data/artisys-oficina.sqlite') {
  if (path !== ':memory:') {
    const resolved = resolve(path);
    mkdirSync(dirname(resolved), { recursive: true });
    path = resolved;
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const version='2026-11-03-main-p0-p3';
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)){
    migrateMarketParity(db);migrateLocalPaymentCollection(db);return;
  }
  return transaction(db,()=>{
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'ArtiSys Oficina',
      document TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO company_settings(id, updated_at) VALUES (1, datetime('now'));

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, document TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      type TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      year INTEGER, serial_number TEXT NOT NULL DEFAULT '', internal_id TEXT NOT NULL DEFAULT '',
      hour_meter REAL NOT NULL DEFAULT 0 CHECK(hour_meter >= 0),
      license_plate TEXT, vin TEXT, odometer_km REAL CHECK(odometer_km >= 0),
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS technicians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', specialty TEXT NOT NULL DEFAULT '',
      user_id INTEGER REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      os_number INTEGER NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      entered_at TEXT NOT NULL, problem_reported TEXT NOT NULL,
      diagnosis TEXT NOT NULL DEFAULT '', technician_id INTEGER REFERENCES technicians(id),
      estimated_delivery TEXT, priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('BAIXA','NORMAL','ALTA','URGENTE')),
      internal_notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ENTRADA',
      completed_at TEXT, delivered_at TEXT,
      snapshot_customer TEXT NOT NULL, snapshot_machine TEXT NOT NULL,
      quote_total_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vehicle_maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      work_order_id INTEGER REFERENCES work_orders(id),
      kind TEXT NOT NULL CHECK(kind IN ('REVISAO','GARANTIA')),
      performed_at TEXT,
      next_due_date TEXT,
      next_due_km REAL CHECK(next_due_km >= 0),
      warranty_until TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_machine ON vehicle_maintenance_records(machine_id,created_at);

    CREATE TABLE IF NOT EXISTS work_order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
      from_status TEXT, to_status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      changed_by INTEGER REFERENCES users(id), changed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS work_order_change_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by INTEGER REFERENCES users(id),
      changed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL UNIQUE REFERENCES work_orders(id),
      subtotal_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', valid_until TEXT,
      approval_status TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK(approval_status IN ('RASCUNHO','AGUARDANDO','APROVADO','REPROVADO')),
      rejection_reason TEXT NOT NULL DEFAULT '', approved_at TEXT, rejected_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('PECA','MAO_DE_OBRA','TERCEIRO')),
      description TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity >= 0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0), total_cents INTEGER NOT NULL CHECK(total_cents >= 0)
    );

    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'UN', cost_cents INTEGER NOT NULL DEFAULT 0,
      sale_price_cents INTEGER NOT NULL DEFAULT 0, quantity REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0, location TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      type TEXT NOT NULL CHECK(type IN ('ENTRADA','SAIDA_MANUAL','CONSUMO_OS','ESTORNO','AJUSTE')),
      quantity_delta REAL NOT NULL, work_order_id INTEGER REFERENCES work_orders(id),
      note TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
      source_type TEXT, source_item_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS work_order_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES work_orders(id), part_id INTEGER NOT NULL REFERENCES parts(id),
      quantity REAL NOT NULL CHECK(quantity > 0), unit_price_cents INTEGER NOT NULL,
      movement_id INTEGER NOT NULL REFERENCES inventory_movements(id), reversed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('DIAGNOSTICO','EXECUCAO','VISITA','PREVISAO_ENTREGA','RETORNO')),
      title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT,
      customer_id INTEGER REFERENCES customers(id), machine_id INTEGER REFERENCES machines(id),
      work_order_id INTEGER REFERENCES work_orders(id), technician_id INTEGER REFERENCES technicians(id),
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checklist_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('ENTRADA','ENTREGA','PERSONALIZADO')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checklist_template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, label TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS work_order_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES work_orders(id), template_id INTEGER REFERENCES checklist_templates(id),
      template_name_snapshot TEXT NOT NULL, completed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checklist_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL REFERENCES work_order_checklists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, label_snapshot TEXT NOT NULL,
      response TEXT NOT NULL CHECK(response IN ('OK','ATENCAO','NAO_SE_APLICA')),
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
      category TEXT NOT NULL CHECK(category IN ('ENTRADA','DIAGNOSTICO','SERVICO','ENTREGA','OUTRO')),
      caption TEXT NOT NULL DEFAULT '', mime_type TEXT NOT NULL, original_name TEXT NOT NULL,
      relative_path TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), method TEXT NOT NULL,
      received_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id), reversed_at TEXT, reversal_note TEXT NOT NULL DEFAULT '',
      request_id TEXT, request_payload_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('SALE','OS_RECEIPT')),
      source_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('PAID','REFUNDED')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents != 0),
      method TEXT NOT NULL,
      cash_session_id INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(source_type,source_id,event_type)
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
      due_date TEXT, paid_at TEXT, reference_center TEXT NOT NULL DEFAULT '',
      work_order_id INTEGER REFERENCES work_orders(id), note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_idempotency (
      scope TEXT NOT NULL,
      request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope,request_id)
    );
    CREATE TABLE IF NOT EXISTS domain_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_domain_outbox_pending ON domain_outbox(delivered_at,id);
    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_work_orders_machine ON work_orders(machine_id);
    CREATE INDEX IF NOT EXISTS idx_work_order_changes_os ON work_order_change_history(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_part ON inventory_movements(part_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_starts ON schedule_events(starts_at);
    CREATE INDEX IF NOT EXISTS idx_receipts_os ON receipts(work_order_id);
  `);
  // Migrate older local SQLite files additively; never truncate or rewrite balances.
  const workOrderCols=new Set(db.prepare("PRAGMA table_info('work_orders')").all().map(c=>c.name));
  if(!workOrderCols.has('version'))db.exec('ALTER TABLE work_orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)');
  const checklistCols=new Set(db.prepare("PRAGMA table_info('checklist_template_items')").all().map(c=>c.name));
  if(!checklistCols.has('required'))
    db.exec('ALTER TABLE checklist_template_items ADD COLUMN required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1))');
  const machineCols=new Set(db.prepare("PRAGMA table_info('machines')").all().map(c=>c.name));
  if(!machineCols.has('license_plate'))db.exec('ALTER TABLE machines ADD COLUMN license_plate TEXT');
  if(!machineCols.has('vin'))db.exec('ALTER TABLE machines ADD COLUMN vin TEXT');
  if(!machineCols.has('odometer_km'))db.exec('ALTER TABLE machines ADD COLUMN odometer_km REAL CHECK(odometer_km >= 0)');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_plate ON machines(license_plate) WHERE license_plate IS NOT NULL AND license_plate<>''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_vin ON machines(vin) WHERE vin IS NOT NULL AND vin<>''");
  const companyCols=new Set(db.prepare("PRAGMA table_info('company_settings')").all().map(c=>c.name));
  if(!companyCols.has('service_profile'))db.exec("ALTER TABLE company_settings ADD COLUMN service_profile TEXT NOT NULL DEFAULT 'MISTA' CHECK(service_profile IN ('MISTA','AUTOMOTIVA','AGRICOLA'))");
  for(const [column,ddl] of [
    ['renavam','renavam TEXT'],['engine','engine TEXT NOT NULL DEFAULT \'\''],['fuel_type','fuel_type TEXT']]){
    if(!machineCols.has(column))db.exec('ALTER TABLE machines ADD COLUMN '+ddl);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_renavam ON machines(renavam) WHERE renavam IS NOT NULL AND renavam<>'';
    CREATE TABLE IF NOT EXISTS part_fitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      brand_key TEXT NOT NULL, model_key TEXT NOT NULL,
      year_from INTEGER, year_to INTEGER, engine_key TEXT NOT NULL DEFAULT '',
      fuel_type TEXT, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_part_fitments_search ON part_fitments(brand_key,model_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_part_fitments_unique ON part_fitments(
      part_id,brand_key,model_key,COALESCE(year_from,0),COALESCE(year_to,0),
      engine_key,COALESCE(fuel_type,'')
    );
    CREATE TABLE IF NOT EXISTS obd_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      work_order_id INTEGER REFERENCES work_orders(id),
      protocol TEXT NOT NULL DEFAULT '',
      raw_response TEXT NOT NULL, codes_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obd_scans_machine ON obd_scans(machine_id,id DESC);
    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      name TEXT NOT NULL, interval_days INTEGER, interval_km REAL, interval_hours REAL,
      next_due_date TEXT, next_due_km REAL, next_due_hours REAL,
      last_completed_at TEXT, notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_plans_machine ON maintenance_plans(machine_id,active);
    CREATE TABLE IF NOT EXISTS maintenance_plan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES maintenance_plans(id),
      work_order_id INTEGER REFERENCES work_orders(id),
      performed_at TEXT NOT NULL, odometer_km REAL, hour_meter REAL,
      created_at TEXT NOT NULL
    );
  `);
  // Evolução aditiva: registros históricos OBD-II continuam legíveis.
  const scanCols=new Set(db.prepare("PRAGMA table_info('obd_scans')").all().map(c=>c.name));
  for(const [name,definition] of [
    ['adapter_id',"adapter_id TEXT NOT NULL DEFAULT 'ELM327_SERIAL'"],
    ['source',"source TEXT NOT NULL DEFAULT 'REAL' CHECK(source IN ('REAL','SIMULATED'))"],
    ['details_json',"details_json TEXT NOT NULL DEFAULT '{}'"],
    ['notes',"notes TEXT NOT NULL DEFAULT ''"]
  ])if(!scanCols.has(name))db.exec('ALTER TABLE obd_scans ADD COLUMN '+definition);
  const inventoryCols=new Set(db.prepare("PRAGMA table_info('inventory_movements')").all().map(c=>c.name));
  if(!inventoryCols.has('source_type'))db.exec('ALTER TABLE inventory_movements ADD COLUMN source_type TEXT');
  if(!inventoryCols.has('source_item_id'))db.exec('ALTER TABLE inventory_movements ADD COLUMN source_item_id INTEGER');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_source_unique ON inventory_movements(source_type,source_item_id) WHERE source_type IS NOT NULL AND source_item_id IS NOT NULL');
  const receiptCols=new Set(db.prepare("PRAGMA table_info('receipts')").all().map(c=>c.name));
  if(!receiptCols.has('request_id'))db.exec('ALTER TABLE receipts ADD COLUMN request_id TEXT');
  if(!receiptCols.has('request_payload_hash'))db.exec('ALTER TABLE receipts ADD COLUMN request_payload_hash TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_request_id ON receipts(request_id) WHERE request_id IS NOT NULL');
  // Backfill only ledger rows: never touch settled receipts or bank balances.
  db.exec(`
    INSERT OR IGNORE INTO payment_events(source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at)
    SELECT 'OS_RECEIPT',id,'PAID',amount_cents,method,NULL,received_at FROM receipts;
    INSERT OR IGNORE INTO payment_events(source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at)
    SELECT 'OS_RECEIPT',id,'REFUNDED',-amount_cents,method,NULL,reversed_at FROM receipts WHERE reversed_at IS NOT NULL;
  `);
  migrateFiscal(db);
  migrateMarketParity(db);
   migrateLocalPaymentCollection(db);
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_work_orders_status_id ON work_orders(status,id DESC);
    CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders(customer_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_work_orders_delivery ON work_orders(status,delivered_at);
    CREATE INDEX IF NOT EXISTS idx_work_orders_technician ON work_orders(technician_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_customer_name ON customers(name COLLATE NOCASE,id);
    CREATE INDEX IF NOT EXISTS idx_machines_customer_id ON machines(customer_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_parts_active_description ON parts(active,description COLLATE NOCASE,id);
    CREATE INDEX IF NOT EXISTS idx_work_order_status_history_os ON work_order_status_history(work_order_id,changed_at,id);
    CREATE INDEX IF NOT EXISTS idx_work_order_parts_os ON work_order_parts(work_order_id,id);
    CREATE INDEX IF NOT EXISTS idx_work_order_checklists_os ON work_order_checklists(work_order_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_checklist_responses_checklist ON checklist_responses(checklist_id,position);
    CREATE INDEX IF NOT EXISTS idx_attachments_os ON attachments(work_order_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_receipts_os_date ON receipts(work_order_id,received_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id,id);
    CREATE INDEX IF NOT EXISTS idx_inventory_work_order ON inventory_movements(work_order_id,id);
    CREATE INDEX IF NOT EXISTS idx_payment_events_created ON payment_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_paid ON expenses(paid_at);
    CREATE INDEX IF NOT EXISTS idx_quotes_approved_at ON quotes(approval_status,approved_at);
    CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance_plans(active,next_due_date);
    CREATE INDEX IF NOT EXISTS idx_fiscal_documents_id ON fiscal_documents(status,id DESC);
  `);
  const outboxCols=new Set(db.prepare("PRAGMA table_info('domain_outbox')").all().map(x=>x.name));
  if(!outboxCols.has('next_attempt_at'))db.exec('ALTER TABLE domain_outbox ADD COLUMN next_attempt_at TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_outbox_retry ON domain_outbox(delivered_at,next_attempt_at,id)');
  db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,nowIso());
  });
}

let nextSavepoint=0;
// SAVEPOINT é compatível com transações já abertas: um comando HTTP pode
// envolver os serviços e o outbox numa única confirmação SQLite.
export function transaction(db,fn){
  const name='p0_tx_'+(++nextSavepoint);
  db.exec('SAVEPOINT '+name);
  try{
    const result=fn();
    if(result&&typeof result.then==='function')
      throw new Error('Transação SQLite requer callback síncrono');
    db.exec('RELEASE SAVEPOINT '+name);
    return result;
  }catch(error){
    try{db.exec('ROLLBACK TO SAVEPOINT '+name)}catch{}
    try{db.exec('RELEASE SAVEPOINT '+name)}catch{}
    throw error;
  }
}
