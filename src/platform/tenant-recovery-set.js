import {DatabaseSync} from 'node:sqlite';
import {join,resolve} from 'node:path';
import {verifyBackup} from './backup.js';
import {validateRecoveryCatalog} from './recovery-catalog.js';

function inspectArchive(archivePath,{registry=false}={}){
 const manifest=verifyBackup(archivePath);
 const db=new DatabaseSync(join(archivePath,'database.sqlite'),{readOnly:true});
 try{
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')
   throw Error('Integridade SQLite falhou no backup: '+archivePath);
  if(db.prepare('PRAGMA foreign_key_check').all().length)
   throw Error('Referências estrangeiras inválidas no backup: '+archivePath);
  if(!registry)return {manifest};
  const units=db.prepare('SELECT id,company_id FROM tenant_units ORDER BY id').all();
  return {manifest,units};
 }finally{db.close();}
}

/**
 * Offline, read-only disaster-recovery preflight. Every tenant backup must
 * belong to exactly one registry unit and be contemporaneous with the registry
 * snapshot. NEVER switches live databases or claims cross-database atomicity.
 */
export function verifyTenantRecoverySet({registryArchive,unitArchives,maxSkewMs=900000}={}){
 if(typeof registryArchive!=='string'||!registryArchive.trim()||!Array.isArray(unitArchives))
  throw Error('Arquivos de recuperação do registro e das unidades obrigatórios');
 const registryPath=resolve(registryArchive);
 const {manifest:registryManifest,units:registryUnits}=inspectArchive(registryPath,{registry:true});
 const archives=unitArchives.map(archive=>{
  if(typeof archive?.archivePath!=='string'||resolve(archive.archivePath)===registryPath)
   throw Error('Arquivo de unidade não pode reutilizar o registro');
  const inspected=inspectArchive(archive.archivePath);
  if(Number(inspected.manifest.tenant?.companyId)!==Number(archive.companyId)||
     Number(inspected.manifest.tenant?.unitId)!==Number(archive.unitId))
   throw Error('Identidade empresa/unidade do backup não corresponde ao catálogo');
  return {...archive,...inspected};
 });
 const plan=validateRecoveryCatalog({registryUnits,registryManifest,unitArchives:archives,maxSkewMs});
 return {...plan,status:'verified-staging-only',liveDataModified:false};
}
