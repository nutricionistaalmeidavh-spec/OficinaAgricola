import { openDatabase, migrate } from './db.js';
import { seed } from './seed.js';
import { createAppServer } from './server.js';
import { listLanUrls, resolveServerConfig } from './platform/network.js';

const db = openDatabase();
migrate(db);
seed(db);
const server = createAppServer({ db });
const { port, host } = resolveServerConfig(process.env);

server.listen(port, host, () => {
  console.log(`Oficina Agrícola em http://${host}:${port}`);
  for (const url of listLanUrls({ port })) console.log(`Rede local: ${url}`);
});
