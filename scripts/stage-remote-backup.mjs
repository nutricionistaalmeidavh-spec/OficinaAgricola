#!/usr/bin/env node
import { resolve } from 'node:path';
import { createS3BackupClient } from '../src/platform/s3-backup.js';
import { restoreMirroredTenantBackup } from '../src/platform/tenant-remote-restore.js';

// Recovery only creates a quarantined, verified archive. Never swaps a live
// tenant DB, changes runtime configuration or writes secrets to stdout.
const [remoteArchive,stagingPath]=process.argv.slice(2);
if(!remoteArchive||!stagingPath){
  console.error('Uso: node scripts/stage-remote-backup.mjs registry/<backup-id> /caminho/staging');
  process.exitCode=2;
}else{
  try{
    const client=createS3BackupClient({
      endpoint:process.env.OFICINA_BACKUP_S3_ENDPOINT,
      bucket:process.env.OFICINA_BACKUP_S3_BUCKET,
      region:process.env.OFICINA_BACKUP_S3_REGION||'us-east-1',
      accessKeyId:process.env.OFICINA_BACKUP_S3_ACCESS_KEY_ID,
      secretAccessKey:process.env.OFICINA_BACKUP_S3_SECRET_ACCESS_KEY,
      prefix:process.env.OFICINA_BACKUP_S3_PREFIX||'oficina-backups'
    });
    const result=await restoreMirroredTenantBackup({
      client,remoteArchive,restoreRoot:resolve(stagingPath)
    });
    process.stdout.write(JSON.stringify({
      archivePath:result.archivePath,
      filesRestored:result.filesRestored,
      sourceArchive:result.sourceArchive,
      liveDataModified:false,
      nextStep:'Validate registry and matching tenant snapshots; restore only with service stopped.'
    },null,2)+'\n');
  }catch(error){
    console.error('Não foi possível validar o backup remoto:',error.message);
    process.exitCode=1;
  }
}
