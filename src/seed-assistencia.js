import { resolveDatabasePath, resolveStoragePath } from './platform/data-location.js';
import { openDatabase, migrate } from './db.js';
import { migrateAssistencia } from './assistencia-schema.js';
import { seed } from './seed.js';

process.env.DATABASE_PATH = resolveDatabasePath();

const db = openDatabase();
try {
  migrate(db);
  migrateAssistencia(db);
  const result = seed(db);
  console.log(result.demoPasswordUsed
    ? 'Seed ArtiSys Oficina concluído. DEV: senha padrão Admin@1234; altere antes de uso real.'
    : 'Seed ArtiSys Oficina concluído.');
} finally {
  db.close();
}
