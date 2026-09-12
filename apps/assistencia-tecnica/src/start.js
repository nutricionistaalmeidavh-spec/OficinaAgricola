import { openDatabase, migrate } from './db.js';
import { seed } from './seed.js';
import { migrateAssistencia } from './assistencia-schema.js';
import { createAssistenciaServer } from './server-assistencia.js';
import { listLanUrls, resolveServerConfig } from './platform/network.js';

process.env.DATABASE_PATH ||= './data/assistencia-tecnica.sqlite';
process.env.STORAGE_DIR ||= './storage/assistencia-tecnica/uploads';
process.env.PORT ||= '3344';

const db = openDatabase();
migrate(db);
migrateAssistencia(db);
seed(db);
const server = createAssistenciaServer({ db, storageDir: process.env.STORAGE_DIR });
const { port, host } = resolveServerConfig(process.env);

server.listen(port, host, () => {
  console.log(`Assistência Técnica ArtiSys em http://${host}:${port}`);
  for (const url of listLanUrls({ port })) console.log(`Rede local: ${url}`);
});
