import { openDatabase, migrate } from './db.js';
import { migrateAssistencia } from './assistencia-schema.js';
import { seed } from './seed.js';

process.env.DATABASE_PATH ||= './data/assistencia-tecnica.sqlite';

const db = openDatabase();
try {
  migrate(db);
  migrateAssistencia(db);
  const result = seed(db);
  console.log(result.demoPasswordUsed
    ? 'Seed Assistência Técnica concluído. DEV: senha padrão Admin@1234; altere antes de uso real.'
    : 'Seed Assistência Técnica concluído.');
} finally {
  db.close();
}
