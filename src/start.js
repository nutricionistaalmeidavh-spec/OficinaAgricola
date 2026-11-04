import {createSecureSmtpReminderSender} from './platform/billing-smtp.js';
import {cleanupOperationalData} from './platform/data-maintenance.js';
import { resolveDatabasePath, resolveStoragePath } from './platform/data-location.js';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import { openDatabase, migrate } from './db.js';
import { seed } from './seed.js';
import { migrateAssistencia } from './assistencia-schema.js';
import { createAssistenciaServer } from './server-assistencia.js';
import { createEventRuntime } from './platform/event-runtime.js';
import {dispatchOutbox} from './platform/outbox.js';
import {recoverOrphanAttachments} from './services/operations.js';
import {auditInvariants} from './services/reconciliation.js';
import {createMaintenanceCrmTasks} from './services/market-parity.js';
import {startBackupSchedule} from './platform/backup-scheduler.js';
import { listLanUrls, resolveServerConfig } from './platform/network.js';

if(String(process.env.OFICINA_DATABASE_ENGINE||'sqlite').toLowerCase()!=='sqlite'||
   String(process.env.OFICINA_OBJECT_STORAGE||'disk').toLowerCase()!=='disk')
  throw new Error('Provedores alternativos exigem npm run start:multi; modo legado não pode ignorar configuração de backend');
process.env.DATABASE_PATH = resolveDatabasePath();
process.env.STORAGE_DIR = resolveStoragePath({databasePath:process.env.DATABASE_PATH});
process.env.EVENT_LOG_PATH ||= './data/oficina-events.jsonl';
process.env.PORT ||= '3344';

const db = openDatabase();
// Never bypass the multiempresa membership registry with a legacy server.
if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenant_registry_link'").get()){
  db.close();
  throw new Error('Banco vinculado ao modo multiempresa: use npm run start:multi. Modo legado bloqueado para não ignorar permissões.');
}
migrate(db);
migrateAssistencia(db);
seed(db);
recoverOrphanAttachments(db,process.env.STORAGE_DIR);
const eventRuntime = createEventRuntime({ auditPath: process.env.EVENT_LOG_PATH });
const flushEvents=()=>void dispatchOutbox(db,eventRuntime,100,{respectBackoff:true}).catch(error=>
  console.error('[outbox]',error.message));
const outboxTimer=setInterval(flushEvents,15000);
function maintainDatabase(){
 try{
   const result=cleanupOperationalData(db,{deliveredRetentionDays:Number(process.env.OUTBOX_RETENTION_DAYS||0)});
   db.exec('PRAGMA optimize');
   if(result.sessions||result.deliveredEvents)console.info('[database] Registros operacionais expirados:',result);
 }catch(error){console.error('[database] Manutenção:',error.message);}
}
maintainDatabase();
const maintenanceTimer=setInterval(maintainDatabase,60*60*1000);
maintenanceTimer.unref?.();
outboxTimer.unref?.();
let lastReconciliationWarning=null;
let reconciliationCursors={};
function reconcile(){
 try{
   const audit=auditInvariants(db,{batchSize:500,cursors:reconciliationCursors});
    reconciliationCursors=audit.nextCursor;
   const signature=JSON.stringify(audit.errors);
   if(signature!==lastReconciliationWarning){
     lastReconciliationWarning=signature;
     if(!audit.ok)console.warn('[canonicidade] Divergências identificadas (somente leitura):',signature);
     else console.info('[canonicidade] Lote de auditoria verificado');
   }
 }catch(error){console.error('[canonicidade] Falha de auditoria:',error.message)}
}
const reconciliationTimer=setInterval(reconcile,15*60*1000);
reconciliationTimer.unref?.();
function syncPreventiveReminders(){
 try{const result=createMaintenanceCrmTasks(db,{daysAhead:7});if(result.created)console.info('[crm] Lembretes preventivos gerados:',result.created)}
 catch(error){console.error('[crm] Falha ao gerar lembretes locais:',error.message)}
}
const preventiveTimer=setInterval(syncPreventiveReminders,6*60*60*1000);
preventiveTimer.unref?.();
const { port, host } = resolveServerConfig(process.env);
const tls=process.env.HTTPS_CERT_FILE&&process.env.HTTPS_KEY_FILE?{
  cert:readFileSync(process.env.HTTPS_CERT_FILE),
  key:readFileSync(process.env.HTTPS_KEY_FILE)
}:null;
// Chave Pix local explícita: modo multiempresa nunca herda uma chave global.
const pixStatic=process.env.OFICINA_PIX_KEY&&process.env.OFICINA_PIX_MERCHANT_NAME&&process.env.OFICINA_PIX_CITY?{
  pixKey:process.env.OFICINA_PIX_KEY,
  merchantName:process.env.OFICINA_PIX_MERCHANT_NAME,
  merchantCity:process.env.OFICINA_PIX_CITY
}:null;
const server = createAssistenciaServer({ db, storageDir: process.env.STORAGE_DIR, eventRuntime, tls,
  paymentOptions:{pixStatic}
});
const stopBackupSchedule=startBackupSchedule({
 databasePath:process.env.DATABASE_PATH,
 uploadsPath:process.env.STORAGE_DIR,
 backupRoot:process.env.BACKUP_ROOT||join(dirname(process.env.DATABASE_PATH),'backups'),
 retention:Number(process.env.BACKUP_RETENTION||7)
});

server.listen(port, host, () => {
  console.log(`ArtiSys Oficina em ${tls?'https':'http'}://${host}:${port}`);
  if(tls)for(const url of listLanUrls({ port }))console.log(`Rede local HTTPS: ${url}`);
  flushEvents();
  reconcile();
  syncPreventiveReminders();
});

const shutdown = () => {
  clearInterval(outboxTimer);
  clearInterval(maintenanceTimer);
  clearInterval(reconciliationTimer);
  clearInterval(preventiveTimer);
  stopBackupSchedule();
  server.close(async () => {
    await dispatchOutbox(db,eventRuntime).catch(e=>console.error('[outbox]',e.message));
    eventRuntime.close();
    db.close();
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
