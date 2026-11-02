import { DatabaseSync } from 'node:sqlite';
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
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return db;
}

export function migrate(db) {
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
      hour_meter REAL NOT NULL DEFAULT 0 CHECK(hour_meter >= 0), notes TEXT NOT NULL DEFAULT '',
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
      position INTEGER NOT NULL, label TEXT NOT NULL
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
      created_by INTEGER REFERENCES users(id), reversed_at TEXT, reversal_note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
      due_date TEXT, paid_at TEXT, reference_center TEXT NOT NULL DEFAULT '',
      work_order_id INTEGER REFERENCES work_orders(id), note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_work_orders_machine ON work_orders(machine_id);
    CREATE INDEX IF NOT EXISTS idx_work_order_changes_os ON work_order_change_history(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_part ON inventory_movements(part_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_starts ON schedule_events(starts_at);
    CREATE INDEX IF NOT EXISTS idx_receipts_os ON receipts(work_order_id);
  `);
  // Migrate older local SQLite files additively; never truncate or rewrite balances.
  const inventoryCols=new Set(db.prepare("PRAGMA table_info('inventory_movements')").all().map(c=>c.name));
  if(!inventoryCols.has('source_type'))db.exec('ALTER TABLE inventory_movements ADD COLUMN source_type TEXT');
  if(!inventoryCols.has('source_item_id'))db.exec('ALTER TABLE inventory_movements ADD COLUMN source_item_id INTEGER');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_source_unique ON inventory_movements(source_type,source_item_id) WHERE source_type IS NOT NULL AND source_item_id IS NOT NULL');
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
