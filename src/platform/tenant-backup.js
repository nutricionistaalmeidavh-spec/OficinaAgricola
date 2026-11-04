import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup, verifyBackup, restoreBackup } from './backup.js';
import { validateBackupRestoration } from './backup-scheduler.js';
import { mirrorVerifiedTenantBackups } from './s3-backup.js';

const ARCHIVE=/^20\d{2}-\d{2}-\d{2}T[0-9-]+Z-[0-9a-f]{8}$/i;
function archiveRecords(root,tenant=null){
  if(!existsSync(root))return [];
  return readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&ARCHIVE.test(e.name))
    .map(e=>{const path=join(root,e.name);try{const m=verifyBackup(path);
      if(tenant&&(Number(m.tenant?.companyId)!==tenant.companyId||Number(m.tenant?.unitId)!==tenant.unitId))return null;
      return {path,time:Date.parse(m.createdAt)};}catch{return null;}})
    .filter(x=>x&&Number.isFinite(x.time)).sort((a,b)=>b.time-a.time);
}
function verifyRegistryRestoration(archive){
  const root=mkdtempSync(join(tmpdir(),'oficina-registry-proof-'));
  try{
    const path=join(root,'registry.sqlite');
    restoreBackup({backupDir:archive,databasePath:path,uploadsPath:join(root,'uploads')});
    const db=new DatabaseSync(path,{readOnly:true});
    try{
      if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Integridade do registro falhou');
      if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Vínculos inconsistentes no registro');
      if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_memberships'").get())
        throw Error('Registro não contém vínculos');
    }finally{db.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
}
export function runMultiTenantBackupCycle({
  registryDb,registryPath,legacyDatabasePath,legacyStorageDir,tenantsRoot,backupRoot,retention=7,now=new Date(),minIntervalMs=86400000
}){
  if(!registryDb||!registryPath||!legacyDatabasePath||!tenantsRoot||!backupRoot)throw Error('Backup multiempresa sem configuração');
  const units=registryDb.prepare('SELECT id,company_id FROM tenant_units ORDER BY id').all();
  const jobs=[{databasePath:registryPath,uploadsPath:null,target:join(backupRoot,'registry'),kind:'registry'}];
  for(const unit of units){
    const legacy=unit.id===1&&unit.company_id===1;
    const dir=join(tenantsRoot,'company-'+unit.company_id,'unit-'+unit.id);
    jobs.push({databasePath:legacy?legacyDatabasePath:join(dir,'oficina.sqlite'),
      uploadsPath:legacy?legacyStorageDir:join(dir,'uploads'),
      target:join(backupRoot,'company-'+unit.company_id,'unit-'+unit.id),kind:'unit',
      tenant:{companyId:unit.company_id,unitId:unit.id}});
  }
  const safeRetention=Math.min(60,Math.max(2,Number(retention)||7));
  const done=[];
  for(const job of jobs){
    if(!existsSync(job.databasePath)){done.push({kind:job.kind,skipped:true,reason:'database-not-initialized'});continue;}
    mkdirSync(job.target,{recursive:true});
    const existing=archiveRecords(job.target,job.tenant);
    if(existing.length&&now.getTime()-existing[0].time<minIntervalMs){
      done.push({kind:job.kind,created:false,verified:true,backupDir:existing[0].path});
      continue;
    }
    const result=createBackup({databasePath:job.databasePath,uploadsPath:job.uploadsPath,backupRoot:job.target,now,tenant:job.tenant});
    verifyBackup(result.backupDir);
    if(job.kind==='registry')verifyRegistryRestoration(result.backupDir);
    else validateBackupRestoration(result.backupDir);
    const valid=archiveRecords(job.target,job.tenant);
    for(const obsolete of valid.slice(safeRetention))rmSync(obsolete.path,{recursive:true,force:true});
    done.push({kind:job.kind,created:true,verified:true,backupDir:result.backupDir});
  }
  return done;
}
export function startMultiTenantBackupSchedule(options){
  let stopped=false,busy=false;
  const run=async()=>{
    if(stopped||busy)return;busy=true;
    try{
      const result=runMultiTenantBackupCycle(options);
      console.info('[tenancy-backup]',result.filter(x=>x.created).length,'backups locais verificados');
      if(options.s3BackupClient){
        const mirrored=await mirrorVerifiedTenantBackups({
          records:result,backupRoot:options.backupRoot,client:options.s3BackupClient
        });
        console.info('[tenancy-backup-remote]',mirrored.length,'arquivos de backup completos');
      }
    }catch(error){
      // Never delete or weaken local backups when the optional remote fails.
      console.error('[tenancy-backup] Falha:',error.message);
    }finally{busy=false;}
  };
  const initial=setImmediate(()=>void run());
  const timer=setInterval(()=>void run(),3600000);timer.unref?.();
  return ()=>{stopped=true;clearImmediate(initial);clearInterval(timer);};
}
