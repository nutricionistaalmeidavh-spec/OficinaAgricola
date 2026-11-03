// Backups locais com prova de restauração antes de retenção; zero SaaS.
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,existsSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackup,verifyBackup,restoreBackup} from './backup.js';

const backupFolder=/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9-]+Z-[0-9a-f]{8}$/i;
function verifiedArchiveNames(root){
 if(!existsSync(root))return [];
 return readdirSync(root,{withFileTypes:true})
   .filter(entry=>entry.isDirectory()&&backupFolder.test(entry.name))
   .map(entry=>{
     const path=join(root,entry.name);
     try{
       const manifest=JSON.parse(readFileSync(join(path,'manifest.json'),'utf8'));
       return {path,createdAt:Date.parse(manifest.createdAt)};
     }catch{return null}
   }).filter(v=>v&&Number.isFinite(v.createdAt)).sort((a,b)=>b.createdAt-a.createdAt);
}
export function validateBackupRestoration(backupDir){
 const stage=mkdtempSync(join(tmpdir(),'oficina-restore-proof-'));
 try{
   verifyBackup(backupDir);
   const databasePath=join(stage,'database.sqlite'),uploadsPath=join(stage,'uploads');
   restoreBackup({backupDir,databasePath,uploadsPath});
   const restored=new DatabaseSync(databasePath,{readOnly:true});
   try{
     const result=restored.prepare('PRAGMA integrity_check').all();
     if(result.length!==1||result[0].integrity_check!=='ok')
       throw new Error('Banco restaurado não passou no PRAGMA integrity_check');
     if(restored.prepare('PRAGMA foreign_key_check').all().length)
       throw new Error('Banco restaurado contém referências inválidas');
     const customer=restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();
     if(!customer)throw new Error('Schema operacional ausente no banco restaurado');
   }finally{restored.close()}
   return true;
 }finally{rmSync(stage,{recursive:true,force:true})}
}
export function runVerifiedBackupCycle({
 databasePath,uploadsPath,backupRoot,now=new Date(),retention=7,
 minIntervalMs=24*60*60*1000
}){
 if(!databasePath||!uploadsPath||!backupRoot)throw new Error('Configuração de backup incompleta');
 const safeRetention=Math.max(2,Math.min(60,Number(retention)||7));
 const backups=verifiedArchiveNames(backupRoot);
 if(backups.length&&now.getTime()-backups[0].createdAt<minIntervalMs)
   return {created:false,verified:true,backupDir:backups[0].path};
 const result=createBackup({databasePath,uploadsPath,backupRoot,now});
 verifyBackup(result.backupDir);
 validateBackupRestoration(result.backupDir);
 const valid=verifiedArchiveNames(backupRoot);
 for(const previous of valid.slice(safeRetention))
   rmSync(previous.path,{recursive:true,force:true});
 return {created:true,verified:true,backupDir:result.backupDir};
}
export function startBackupSchedule({
 databasePath,uploadsPath,backupRoot,retention=7,logger=console
}){
 let closed=false,active=false;
 function run(){
   if(closed||active)return;
   active=true;
   try{
     const r=runVerifiedBackupCycle({databasePath,uploadsPath,backupRoot,retention});
     if(r.created)logger.info?.('[backup] Backup local restaurado e verificado:',r.backupDir);
   }catch(error){logger.error?.('[backup] Falha na cópia local:',error.message)}
   finally{active=false}
 }
 const initial=setImmediate(run);
 const timer=setInterval(run,60*60*1000);
 timer.unref?.();
 return ()=>{closed=true;clearImmediate(initial);clearInterval(timer)};
}
