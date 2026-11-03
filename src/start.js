import { resolveDatabasePath, resolveStoragePath } from './platform/data-location.js';
import {readFileSync} from 'node:fs';
import { openDatabase, migrate } from './db.js';
import { seed } from './seed.js';
import { migrateAssistencia } from './assistencia-schema.js';
import { createAssistenciaServer } from './server-assistencia.js';
import { createEventRuntime } from './platform/event-runtime.js';
import {dispatchOutbox} from './platform/outbox.js';
import {recoverOrphanAttachments} from './services/operations.js';
import {auditInvariants} from './services/reconciliation.js';
import { listLanUrls, resolveServerConfig } from './platform/network.js';

process.env.DATABASE_PATH = resolveDatabasePath();
process.env.STORAGE_DIR = resolveStoragePath({databasePath:process.env.DATABASE_PATH});
process.env.EVENT_LOG_PATH ||= './data/oficina-events.jsonl';
process.env.PORT ||= '3344';

const db = openDatabase();
migrate(db);
migrateAssistencia(db);
seed(db);
recoverOrphanAttachments(db,process.env.STORAGE_DIR);
const eventRuntime = createEventRuntime({ auditPath: process.env.EVENT_LOG_PATH });
const flushEvents=()=>void dispatchOutbox(db,eventRuntime).catch(error=>
  console.error('[outbox]',error.message));
const outboxTimer=setInterval(flushEvents,15000);
outboxTimer.unref?.();
let lastReconciliationWarning=null;
function reconcile(){
 try{
   const audit=auditInvariants(db);
   const signature=JSON.stringify(audit.errors);
   if(signature!==lastReconciliationWarning){
     lastReconciliationWarning=signature;
     if(!audit.ok)console.warn('[canonicidade] Divergências identificadas (somente leitura):',signature);
     else console.info('[canonicidade] Livros de estoque/financeiro conciliados');
   }
 }catch(error){console.error('[canonicidade] Falha de auditoria:',error.message)}
}
const reconciliationTimer=setInterval(reconcile,60000);
reconciliationTimer.unref?.();
const { port, host } = resolveServerConfig(process.env);
const tls=process.env.HTTPS_CERT_FILE&&process.env.HTTPS_KEY_FILE?{
  cert:readFileSync(process.env.HTTPS_CERT_FILE),
  key:readFileSync(process.env.HTTPS_KEY_FILE)
}:null;
const server = createAssistenciaServer({ db, storageDir: process.env.STORAGE_DIR, eventRuntime, tls });

server.listen(port, host, () => {
  console.log(`ArtiSys Oficina em ${tls?'https':'http'}://${host}:${port}`);
  if(tls)for(const url of listLanUrls({ port }))console.log(`Rede local HTTPS: ${url}`);
  flushEvents();
  reconcile();
});

const shutdown = () => {
  clearInterval(outboxTimer);
  clearInterval(reconciliationTimer);
  server.close(async () => {
    await dispatchOutbox(db,eventRuntime).catch(e=>console.error('[outbox]',e.message));
    eventRuntime.close();
    db.close();
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
