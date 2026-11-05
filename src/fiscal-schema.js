// Somente metadados e snapshots fiscais. Sem certificado, senha ou chave privada no banco.
// Migração aditiva, reversível por backup, sem tocar nos livros de estoque e pagamento.
export function migrateFiscal(db){
  db.exec(
    "CREATE TABLE IF NOT EXISTS fiscal_documents ("+
    "id INTEGER PRIMARY KEY AUTOINCREMENT,"+
    "kind TEXT NOT NULL CHECK(kind IN ('NFE','NFCE','NFSE')),"+
    "origin_type TEXT NOT NULL CHECK(origin_type IN ('OS','SALE')),"+
    "origin_id INTEGER NOT NULL CHECK(origin_id>0),"+
    "status TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK(status IN ('RASCUNHO','INDETERMINADO','REJEITADA','AUTORIZADA','AUTORIZADA_HOMOLOGACAO','CANCELADA')),"+
    "amount_cents INTEGER NOT NULL CHECK(amount_cents>0),"+
    "snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL,issuer_snapshot_json TEXT,"+
    "request_id TEXT NOT NULL UNIQUE,provider_name TEXT NOT NULL DEFAULT '',"+
    "attempt_id TEXT,access_key TEXT,protocol TEXT,fiscal_number TEXT,fiscal_series TEXT,authorized_xml TEXT,"+
    "response_json TEXT,last_error TEXT NOT NULL DEFAULT '',"+
    "created_at TEXT NOT NULL,updated_at TEXT NOT NULL,authorized_at TEXT,"+
    "UNIQUE(kind,origin_type,origin_id))"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS fiscal_events ("+
    "id INTEGER PRIMARY KEY AUTOINCREMENT,"+
    "document_id INTEGER NOT NULL REFERENCES fiscal_documents(id),"+
    "event_type TEXT NOT NULL,"+
    "details_json TEXT NOT NULL DEFAULT '{}',"+
    "created_at TEXT NOT NULL)"
  );
  const cols=new Set(db.prepare("PRAGMA table_info('fiscal_documents')").all().map(row=>row.name));
  if(!cols.has('environment'))db.exec("ALTER TABLE fiscal_documents ADD COLUMN environment TEXT NOT NULL DEFAULT 'HOMOLOGACAO'");
  if(!cols.has('fiscal_number'))db.exec('ALTER TABLE fiscal_documents ADD COLUMN fiscal_number TEXT');
  if(!cols.has('fiscal_series'))db.exec('ALTER TABLE fiscal_documents ADD COLUMN fiscal_series TEXT');
  if(!cols.has('issuer_snapshot_json'))db.exec('ALTER TABLE fiscal_documents ADD COLUMN issuer_snapshot_json TEXT');
  db.exec(
    "CREATE TABLE IF NOT EXISTS fiscal_settings ("+
    "id INTEGER PRIMARY KEY CHECK(id=1),"+
    "enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),"+
    "environment TEXT NOT NULL DEFAULT 'HOMOLOGACAO' CHECK(environment IN ('HOMOLOGACAO','PRODUCAO')),"+
    "issuer_cnpj TEXT NOT NULL DEFAULT '',issuer_uf TEXT NOT NULL DEFAULT '',"+
    "municipality_ibge TEXT NOT NULL DEFAULT '',tax_regime TEXT NOT NULL DEFAULT '',"+
    "state_registration TEXT NOT NULL DEFAULT '',municipal_registration TEXT NOT NULL DEFAULT '',"+
    "production_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(production_confirmed IN (0,1)),"+
    "updated_at TEXT NOT NULL)"
  );
  db.exec("INSERT OR IGNORE INTO fiscal_settings(id,updated_at) VALUES(1,datetime('now'))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_fiscal_documents_status ON fiscal_documents(status,created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_fiscal_events_document ON fiscal_events(document_id,id)");
}
