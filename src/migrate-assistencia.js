import { resolveDatabasePath, resolveStoragePath } from './platform/data-location.js';
import { openDatabase, migrate } from './db.js';
import { migrateAssistencia } from './assistencia-schema.js';

process.env.DATABASE_PATH = resolveDatabasePath();

const db = openDatabase();
try {
  migrate(db);
  migrateAssistencia(db);
  console.log('Migração ArtiSys Oficina concluída.');
} finally {
  db.close();
}
