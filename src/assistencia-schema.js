import {transaction,nowIso} from './db.js';
export function migrateAssistencia(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const version='2026-11-03-assistencia-p0-p3';
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)){
    // Sistemas legados podem registrar linhas no livro antigo durante uma migração.
    // Validar somente entradas ainda não materializadas, sem refazer saldo de estoque.
    const missing=db.prepare(`
      SELECT 1 FROM sale_stock_movements sm WHERE
      NOT EXISTS(SELECT 1 FROM inventory_movements im
        WHERE im.source_type='SALE_ITEM' AND im.source_item_id=sm.sale_item_id)
      OR (sm.reversed_at IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM inventory_movements im WHERE im.source_type='SALE_RETURN'
          AND im.source_item_id=sm.sale_item_id)) LIMIT 1
    `).get();
    if(missing)transaction(db,()=>db.exec(`
      INSERT OR IGNORE INTO inventory_movements(part_id,type,quantity_delta,work_order_id,note,created_by,created_at,source_type,source_item_id)
      SELECT sm.part_id,'SAIDA_MANUAL',sm.quantity_delta,NULL,'Migração venda legada',NULL,sm.created_at,'SALE_ITEM',sm.sale_item_id
      FROM sale_stock_movements sm;
      INSERT OR IGNORE INTO inventory_movements(part_id,type,quantity_delta,work_order_id,note,created_by,created_at,source_type,source_item_id)
      SELECT sm.part_id,'ESTORNO',-sm.quantity_delta,NULL,'Migração estorno legado',NULL,sm.reversed_at,'SALE_RETURN',sm.sale_item_id
      FROM sale_stock_movements sm WHERE sm.reversed_at IS NOT NULL;
    `));
    return;
  }
  return transaction(db,()=>{
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
      cancel_reason TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      request_payload_hash TEXT
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

  // Migração aditiva: mantém vendas históricas e permite reenvio idempotente.
  const columns=new Set(db.prepare("PRAGMA table_info('sales')").all().map(c=>c.name));
  if(!columns.has('request_id'))db.exec('ALTER TABLE sales ADD COLUMN request_id TEXT');
  if(!columns.has('request_payload_hash'))db.exec('ALTER TABLE sales ADD COLUMN request_payload_hash TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_request_id ON sales(request_id) WHERE request_id IS NOT NULL;');
  const cashCols=new Set(db.prepare("PRAGMA table_info('cash_movements')").all().map(c=>c.name));
  if(!cashCols.has('receipt_id'))db.exec('ALTER TABLE cash_movements ADD COLUMN receipt_id INTEGER REFERENCES receipts(id)');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_receipt_action ON cash_movements(receipt_id,type) WHERE receipt_id IS NOT NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sale_action ON cash_movements(sale_id,type) WHERE sale_id IS NOT NULL");

  // Receitas de balcão legadas entram apenas no ledger lógico, sem duplicar
  // movimentações de caixa já persistidas.
  db.exec(`
    INSERT OR IGNORE INTO payment_events(source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at)
    SELECT 'SALE',id,'PAID',total_cents,payment_method,cash_session_id,created_at
    FROM sales WHERE total_cents>0;
    INSERT OR IGNORE INTO payment_events(source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at)
    SELECT 'SALE',id,'REFUNDED',-total_cents,payment_method,NULL,COALESCE(canceled_at,created_at)
    FROM sales WHERE status='CANCELADA' AND total_cents>0;
  `);

  // Um único livro de estoque: inventory_movements. Histórico sale_stock_movements
  // é migrado uma única vez, SEM reaplicar o delta ao saldo materializado.
  const inventoryCols=new Set(db.prepare("PRAGMA table_info('inventory_movements')").all().map(c=>c.name));
  if(!inventoryCols.has('source_type'))db.exec('ALTER TABLE inventory_movements ADD COLUMN source_type TEXT');
  if(!inventoryCols.has('source_item_id'))db.exec('ALTER TABLE inventory_movements ADD COLUMN source_item_id INTEGER');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_source_unique ON inventory_movements(source_type,source_item_id) WHERE source_type IS NOT NULL AND source_item_id IS NOT NULL");
  db.exec(`
    INSERT OR IGNORE INTO inventory_movements(part_id,type,quantity_delta,work_order_id,note,created_by,created_at,source_type,source_item_id)
    SELECT sm.part_id,'SAIDA_MANUAL',sm.quantity_delta,NULL,'Migração venda legada',NULL,sm.created_at,'SALE_ITEM',sm.sale_item_id
    FROM sale_stock_movements sm;
    INSERT OR IGNORE INTO inventory_movements(part_id,type,quantity_delta,work_order_id,note,created_by,created_at,source_type,source_item_id)
    SELECT sm.part_id,'ESTORNO',-sm.quantity_delta,NULL,'Migração estorno legado',NULL,sm.reversed_at,'SALE_RETURN',sm.sale_item_id
    FROM sale_stock_movements sm WHERE sm.reversed_at IS NOT NULL;
  `);


  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_status_id ON sales(status,id DESC);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id,id);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_status_id ON cash_sessions(status,id DESC);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_created ON cash_movements(created_at);
  `);
  db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,nowIso());
  });
}
