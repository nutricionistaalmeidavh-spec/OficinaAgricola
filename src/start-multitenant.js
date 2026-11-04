import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveDatabasePath, resolveStoragePath } from './platform/data-location.js';
import { openDatabase } from './db.js';
import { createMultiTenantServer } from './platform/multi-tenant-server.js';
import { resolveServerConfig, listLanUrls } from './platform/network.js';
import { startMultiTenantBackupSchedule } from './platform/tenant-backup.js';
import { createS3BackupClient } from './platform/s3-backup.js';
import { loadTenantFiscalConfigs } from './platform/tenant-fiscal.js';
import {loadTenantPaymentConfigs} from './platform/tenant-payment.js';
import {loadTenantAsaasConfigs,createTenantAsaasBillingProviders} from './platform/asaas-tenant-options.js';
import {loadNativeTenantBackends} from './platform/native-backend-config.js';

// Database remains canonical SQLite until PostgreSQL/D1 parity is proven.
// Primary attachments may explicitly switch from local disk to private S3.
const databaseEngine=String(process.env.OFICINA_DATABASE_ENGINE||'sqlite').toLowerCase();
const objectsEngine=String(process.env.OFICINA_OBJECT_STORAGE||'disk').toLowerCase();
if(databaseEngine!=='sqlite'||!['disk','s3'].includes(objectsEngine))
  throw new Error('Backend não disponível: use OFICINA_DATABASE_ENGINE=sqlite e storage disk ou s3');
if(objectsEngine==='s3'&&!process.env.OFICINA_ATTACHMENT_S3_ENDPOINT)
  throw new Error('Storage S3 selecionado sem endpoint explícito');
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
const tenantFiscalConfigs=loadTenantFiscalConfigs(process.env.TENANCY_FISCAL_CONFIG_FILE);
const tenantPaymentConfigs=loadTenantPaymentConfigs(process.env.TENANCY_PAYMENT_CONFIG_FILE);
const tenantAsaasConfigs=loadTenantAsaasConfigs(process.env.TENANCY_ASAAS_CONFIG_FILE);
// No native backend is selected without an explicit, approved per-unit map.
const nativeBackendForUnit=loadNativeTenantBackends(process.env.TENANCY_NATIVE_BACKENDS_FILE);
const objectStoreForUnit=objectsEngine==='s3'?(unit=>createS3BackupClient({
  endpoint:process.env.OFICINA_ATTACHMENT_S3_ENDPOINT,
  bucket:process.env.OFICINA_ATTACHMENT_S3_BUCKET,
  region:process.env.OFICINA_ATTACHMENT_S3_REGION||'us-east-1',
  accessKeyId:process.env.OFICINA_ATTACHMENT_S3_ACCESS_KEY_ID,
  secretAccessKey:process.env.OFICINA_ATTACHMENT_S3_SECRET_ACCESS_KEY,
  prefix:(process.env.OFICINA_ATTACHMENT_S3_PREFIX||'oficina-attachments')+
    '/company-'+unit.companyId+'/unit-'+unit.id
})):null;
const server=createMultiTenantServer({
  registryDb,legacyDb,legacyDatabasePath,legacyStorageDir,tenantsRoot,tls,
  tenantFiscalConfigs,tenantPaymentConfigs,objectStoreForUnit,nativeBackendForUnit,
  billingProvidersForUnit:(unit,db)=>createTenantAsaasBillingProviders(unit,tenantAsaasConfigs,{
    first:async(sql,params=[])=>db.prepare(sql).get(...params)
  })
});
const {host,port}=resolveServerConfig(process.env);
// Remote copies are opt-in, while SQLite + local disk remain canonical and free.
const backupS3Endpoint=String(process.env.OFICINA_BACKUP_S3_ENDPOINT||'').trim();
const s3BackupClient=backupS3Endpoint?createS3BackupClient({
  endpoint:backupS3Endpoint,
  bucket:process.env.OFICINA_BACKUP_S3_BUCKET,
  region:process.env.OFICINA_BACKUP_S3_REGION||'us-east-1',
  accessKeyId:process.env.OFICINA_BACKUP_S3_ACCESS_KEY_ID,
  secretAccessKey:process.env.OFICINA_BACKUP_S3_SECRET_ACCESS_KEY,
  prefix:process.env.OFICINA_BACKUP_S3_PREFIX||'oficina-backups'
}):null;
const stopMultiBackup=startMultiTenantBackupSchedule({
  registryDb,registryPath,legacyDatabasePath,legacyStorageDir,tenantsRoot,
  backupRoot:resolve(process.env.BACKUP_ROOT||join(dirname(legacyDatabasePath),'backups-multiempresa')),
  retention:Number(process.env.BACKUP_RETENTION||7),
  s3BackupClient
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
