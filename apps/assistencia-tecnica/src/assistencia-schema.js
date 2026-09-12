import { nowIso } from './db.js';

export function migrateAssistencia(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
      estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK(estimated_minutes >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opened_at TEXT NOT NULL,
      opening_cents INTEGER NOT NULL DEFAULT 0 CHECK(opening_cents >= 0),
      opened_by INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'ABERTO' CHECK(status IN ('ABERTO','FECHADO')),
      closed_at TEXT,
      closing_cents INTEGER,
      expected_cents INTEGER,
      difference_cents INTEGER,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_number INTEGER NOT NULL UNIQUE,
      customer_id INTEGER REFERENCES customers(id),
      cash_session_id INTEGER REFERENCES cash_sessions(id),
      subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0),
      discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents >= 0),
      total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONCLUIDA' CHECK(status IN ('CONCLUIDA','CANCELADA')),
      note TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      canceled_at TEXT,
      cancel_reason TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('PECA','SERVICO','OUTRO')),
      part_id INTEGER REFERENCES parts(id),
      service_id INTEGER REFERENCES service_catalog(id),
      description TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
      total_cents INTEGER NOT NULL CHECK(total_cents >= 0)
    );

    CREATE TABLE IF NOT EXISTS sale_stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
      part_id INTEGER NOT NULL REFERENCES parts(id),
      quantity_delta REAL NOT NULL,
      created_at TEXT NOT NULL,
      reversed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      sale_id INTEGER REFERENCES sales(id),
      type TEXT NOT NULL CHECK(type IN ('VENDA','SUPRIMENTO','SANGRIA','AJUSTE','ESTORNO')),
      amount_cents INTEGER NOT NULL,
      payment_method TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_services_active ON service_catalog(active,name);
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id,created_at);
  `);

  const company = db.prepare('SELECT name FROM company_settings WHERE id=1').get();
  if (company?.name === 'Oficina Agrícola') {
    db.prepare('UPDATE company_settings SET name=?,updated_at=? WHERE id=1')
      .run('Assistência Técnica ArtiSys', nowIso());
  }
}
