// Somente metadados e snapshots fiscais. Sem certificado, senha ou chave privada no banco.
// Migração aditiva, reversível por backup, sem tocar nos livros de estoque e pagamento.
export function migrateFiscal(db){
  db.exec(
    "CREATE TABLE IF NOT EXISTS fiscal_documents ("+
    "id INTEGER PRIMARY KEY AUTOINCREMENT,"+
    "kind TEXT NOT NULL CHECK(kind IN ('NFE','NFSE')),"+
    "origin_type TEXT NOT NULL CHECK(origin_type IN ('OS','SALE')),"+
    "origin_id INTEGER NOT NULL CHECK(origin_id>0),"+
    "status TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK(status IN ('RASCUNHO','INDETERMINADO','REJEITADA','AUTORIZADA','CANCELADA')),"+
    "amount_cents INTEGER NOT NULL CHECK(amount_cents>0),"+
    "snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL,"+
    "request_id TEXT NOT NULL UNIQUE,provider_name TEXT NOT NULL DEFAULT '',"+
    "attempt_id TEXT,access_key TEXT,protocol TEXT,authorized_xml TEXT,"+
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_fiscal_documents_status ON fiscal_documents(status,created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_fiscal_events_document ON fiscal_events(document_id,id)");
}
