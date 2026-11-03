import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveDatabasePath, resolveStoragePath } from './platform/data-location.js';
import { openDatabase } from './db.js';
import { createMultiTenantServer } from './platform/multi-tenant-server.js';
import { resolveServerConfig, listLanUrls } from './platform/network.js';
import { startMultiTenantBackupSchedule } from './platform/tenant-backup.js';

const legacyDatabasePath=resolveDatabasePath();
const legacyStorageDir=resolveStoragePath({databasePath:legacyDatabasePath});
const registryPath=resolve(process.env.TENANCY_REGISTRY_PATH || join(dirname(legacyDatabasePath),'oficina-registry.sqlite'));
const tenantsRoot=resolve(process.env.TENANCY_DATA_ROOT || join(dirname(legacyDatabasePath),'oficina-tenants'));
if(registryPath===legacyDatabasePath)throw new Error('O registro multiempresa não pode usar o banco operacional');
const legacyDb=openDatabase(legacyDatabasePath);
const registryDb=openDatabase(registryPath);
const tls=process.env.HTTPS_CERT_FILE&&process.env.HTTPS_KEY_FILE?{
  cert:readFileSync(process.env.HTTPS_CERT_FILE),
  key:readFileSync(process.env.HTTPS_KEY_FILE)
}:null;
const server=createMultiTenantServer({registryDb,legacyDb,legacyDatabasePath,legacyStorageDir,tenantsRoot,tls});
const {host,port}=resolveServerConfig(process.env);
const stopMultiBackup=startMultiTenantBackupSchedule({
  registryDb,registryPath,legacyDatabasePath,legacyStorageDir,tenantsRoot,
  backupRoot:resolve(process.env.BACKUP_ROOT||join(dirname(legacyDatabasePath),'backups-multiempresa')),
  retention:Number(process.env.BACKUP_RETENTION||7)
});
server.listen(port,host,()=>{
  console.info('ArtiSys Oficina multiempresa em '+(tls?'https':'http')+'://'+host+':'+port);
  if(tls)for(const url of listLanUrls({port}))console.info('Rede local HTTPS: '+url);
});
let stopping=false;
const stop=()=>{
  if(stopping)return;stopping=true;
  stopMultiBackup();
  server.close(()=>{registryDb.close();legacyDb.close();});
};
process.once('SIGINT',stop);
process.once('SIGTERM',stop);
