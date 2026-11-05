// Schema extension for physical counts and product barcodes. Never rewrites stock ledger.
const ddl=[
 ~CREATE TABLE IF NOT EXISTS stocktakes(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ABERTO' CHECK(status IN ('ABERTO','APLICADO')),
  created_by INTEGER REFERENCES users(id),
  applied_by INTEGER REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,applied_at TEXT
 )~,
 ~CREATE TABLE IF NOT EXISTS stocktake_lines(
  id INTEGER PRIMARY KEY,
  stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  expected_quantity REAL NOT NULL CHECK(expected_quantity>=0),
  counted_quantity REAL CHECK(counted_quantity>=0),
  movement_id INTEGER UNIQUE REFERENCES inventory_movements(id),
  UNIQUE(stocktake_id,part_id)
 )~,
 ~CREATE INDEX IF NOT EXISTS idx_stocktake_lines_stocktake ON stocktake_lines(stocktake_id,part_id)~
].map(s=>s.replaceAll('~',''));
const VERSION='2026-11-05-stocktake-barcode-v1';
export function stocktakeSchema(engine){
 if(!['sqlite','postgres'].includes(engine))throw Error('Inventário físico exige PostgreSQL ou SQLite de teste');
 return ddl.map(sql=>engine==='postgres'?sql
   .replace(/\b(id|stocktake_id|part_id|created_by|applied_by|movement_id) INTEGER\b/g,'$1 BIGINT')
   .replace(/\bREAL\b/g,'DOUBLE PRECISION'):sql);
}
export async function migrateStocktakeBarcode(port){
 if(!['sqlite','postgres'].includes(port?.engine))return {skipped:true};
 if(port.engine==='postgres'){
  await port.transaction(async tx=>{
   await tx.run('ALTER TABLE parts ADD COLUMN IF NOT EXISTS barcode TEXT');
   await tx.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_barcode_unique ON parts(barcode) WHERE barcode IS NOT NULL AND barcode<>''");
   for(const sql of stocktakeSchema('postgres'))await tx.run(sql);
   await tx.run('INSERT INTO async_schema_migrations(version,applied_at) VALUES(?,?) ON CONFLICT(version) DO NOTHING',[VERSION,new Date().toISOString()]);
  });
 }else await port.transaction(async tx=>{
  const columns=await tx.all('PRAGMA table_info(parts)');
  if(!columns.some(x=>x.name==='barcode'))await tx.run('ALTER TABLE parts ADD COLUMN barcode TEXT');
  await tx.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_barcode_unique ON parts(barcode) WHERE barcode IS NOT NULL AND barcode<>''");
  for(const sql of stocktakeSchema('sqlite'))await tx.run(sql);
 });
 return {version:VERSION,engine:port.engine};
}
