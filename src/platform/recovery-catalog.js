import {resolve} from 'node:path';

const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const time=value=>{
 const instant=Date.parse(value);
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(instant))
  throw Error('Manifesto de recuperação sem data ISO válida');
 return instant;
};

// Pure fail-closed inventory check. It does not imply atomic snapshots and
// never switches a live tenant. The caller must separately verify all bytes.
export function validateRecoveryCatalog({registryUnits,registryManifest,unitArchives,maxSkewMs=900000}={}){
 if(!Array.isArray(registryUnits)||!registryUnits.length||
    !Array.isArray(unitArchives)||!registryManifest||
    !Number.isSafeInteger(maxSkewMs)||maxSkewMs<0||maxSkewMs>3600000)
   throw Error('Catálogo de recuperação inválido');
 const registryTime=time(registryManifest.createdAt),expected=new Map(),actual=new Map(),paths=new Set();
 for(const unit of registryUnits){
  const unitId=positive(unit.id),companyId=positive(unit.company_id);
  if(!unitId||!companyId||expected.has(unitId))throw Error('Registro de unidades inválido');
  expected.set(unitId,companyId);
 }
 for(const archive of unitArchives){
  const unitId=positive(archive?.unitId),companyId=positive(archive?.companyId);
  if(!unitId||!companyId||typeof archive.archivePath!=='string'||!archive.archivePath.trim())
   throw Error('Identidade ou caminho do arquivo de recuperação inválido');
  if(actual.has(unitId))throw Error('Backup de unidade duplicado: '+unitId);
  if(!expected.has(unitId))throw Error('Unidade desconhecida no conjunto: '+unitId);
  if(expected.get(unitId)!==companyId)throw Error('Backup vinculado à empresa incorreta: '+unitId);
  const canonicalPath=resolve(archive.archivePath);
  if(paths.has(canonicalPath))throw Error('Não reutilize o mesmo arquivo de backup em unidades distintas');
  paths.add(canonicalPath);
  if(!archive.manifest||archive.manifest.version!==1||
     !Array.isArray(archive.manifest.files)||
     !archive.manifest.files.some(f=>f.path==='database.sqlite'))
   throw Error('Backup da unidade sem manifesto SQLite válido: '+unitId);
  if(Math.abs(time(archive.manifest.createdAt)-registryTime)>maxSkewMs)
   throw Error('Janela temporal de backup incoerente entre registro e unidade '+unitId);
  if(archive.remoteArchive!=null &&
     !String(archive.remoteArchive).startsWith('company-'+companyId+'/unit-'+unitId+'/'))
   throw Error('Arquivo remoto não corresponde à unidade '+unitId);
  actual.set(unitId,{unitId,companyId,archivePath:canonicalPath});
 }
 for(const unitId of expected.keys())if(!actual.has(unitId))
  throw Error('Backup de unidade ausente: '+unitId);
 return Object.freeze({unitCount:actual.size,requiresStoppedService:true,
  units:[...actual.values()].sort((a,b)=>a.unitId-b.unitId)});
}
