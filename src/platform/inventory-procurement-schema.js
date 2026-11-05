// Extension-only schema: never rebuild or copy the operational stock ledger.
// Each PostgreSQL unit owns these tables in its schema search_path.
const DDL=[
 `CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,document TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 )`,
 `CREATE TABLE IF NOT EXISTS purchase_orders(
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PEDIDO' CHECK(status IN ('PEDIDO','PARCIAL','RECEBIDO','CANCELADO')),
  created_by INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 )`,
 `CREATE TABLE IF NOT EXISTS purchase_order_items(
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity REAL NOT NULL CHECK(quantity>0),
  received_quantity REAL NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity),
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents>=0),
  UNIQUE(order_id,part_id)
 )`,
 `CREATE TABLE IF NOT EXISTS purchase_receipts(
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',created_by INTEGER,
  created_at TEXT NOT NULL
 )`,
 `CREATE TABLE IF NOT EXISTS purchase_receipt_lines(
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES purchase_receipts(id),
  order_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id),
  quantity REAL NOT NULL CHECK(quantity>0),
  movement_id INTEGER NOT NULL UNIQUE REFERENCES inventory_movements(id),
  UNIQUE(receipt_id,order_item_id)
 )`,
 `CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id,id)`,
 `CREATE INDEX IF NOT EXISTS idx_purchase_items_order ON purchase_order_items(order_id,id)`,
 `CREATE INDEX IF NOT EXISTS idx_purchase_receipts_order ON purchase_receipts(order_id,id)`
];
const VERSION='2026-11-05-inventory-procurement-v1';
export function inventoryProcurementSchema(engine){
 if(!['sqlite','postgres','d1'].includes(engine))throw Error('Engine de compras inválido');
 return DDL.map(sql=>engine==='postgres'?sql
   .replace(/\\b([a-z_][a-z0-9_]*_id|id|created_by|movement_id) INTEGER\\b/g,'$1 BIGINT')
   .replace(/\\bcost_cents INTEGER\\b/g,'cost_cents BIGINT')
   .replace(/\\bREAL\\b/g,'DOUBLE PRECISION'):sql);
}
export async function migrateInventoryProcurement(port){
 if(!port||!['sqlite','postgres','d1'].includes(port.engine))
   throw Error('Backend SQL inválido para migração de compras');
 const queries=inventoryProcurementSchema(port.engine).map(sql=>({sql,params:[]}));
 if(port.engine!=='sqlite')queries.push({
  sql:'INSERT INTO async_schema_migrations(version,applied_at) VALUES(?,?) ON CONFLICT(version) DO NOTHING',
  params:[VERSION,new Date().toISOString()]
 });
 if(port.engine==='d1')await port.batch(queries);
 else await port.transaction(async tx=>{
  for(const item of queries)await tx.run(item.sql,item.params);
 });
 return {version:VERSION,engine:port.engine};
}
