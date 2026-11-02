import { resolveDatabasePath, resolveStoragePath } from './platform/data-location.js';
import { openDatabase, migrate } from './db.js';
import { seed } from './seed.js';
import { migrateAssistencia } from './assistencia-schema.js';
import { createAssistenciaServer } from './server-assistencia.js';
import { createEventRuntime } from './platform/event-runtime.js';
import { listLanUrls, resolveServerConfig } from './platform/network.js';

process.env.DATABASE_PATH = resolveDatabasePath();
process.env.STORAGE_DIR = resolveStoragePath({databasePath:process.env.DATABASE_PATH});
process.env.EVENT_LOG_PATH ||= './data/assistencia-events.jsonl';
process.env.PORT ||= '3344';

const db = openDatabase();
migrate(db);
migrateAssistencia(db);
seed(db);
const eventRuntime = createEventRuntime({ auditPath: process.env.EVENT_LOG_PATH });
const server = createAssistenciaServer({ db, storageDir: process.env.STORAGE_DIR, eventRuntime });
const { port, host } = resolveServerConfig(process.env);

server.listen(port, host, () => {
  console.log(`Assistência Técnica ArtiSys em http://${host}:${port}`);
  for (const url of listLanUrls({ port })) console.log(`Rede local: ${url}`);
});

const shutdown = () => {
  eventRuntime.close();
  server.close(() => db.close());
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
