import {readFileSync,existsSync,statSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {readFile,writeFile,rename,unlink,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const DATA_FILE=fileURLToPath(new URL('../../public/carros3d/top20.json',import.meta.url));
const OWNER='nutricionistaalmeidavh-spec';
const REPOSITORY='assetscarros3d';
const MAX_BYTES=25*1024*1024;
const inflight=new Map();

export const manifest=JSON.parse(readFileSync(DATA_FILE,'utf8'));
const SHA=/^[a-f0-9]{64}$/;
const GIT_REF=/^[a-f0-9]{40}$/;
const FILE=/^(?:assets\/[a-z0-9-]+\.glb|curadoria\/restaurados\/[a-z0-9-]+-restaurado\.glb|curadoria\/(?:geometria|rodas-reparadas)\/[a-z0-9-]+-rodas\.glb)$/;
const SAFE_ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateCatalog(catalog=manifest){
  if(!Array.isArray(catalog?.models))throw new Error('Catálogo 3D ausente');
  const ids=new Set();
  for(const entry of catalog.models){
    if(!SAFE_ID.test(entry.id)||ids.has(entry.id))throw new Error('ID de modelo inválido ou duplicado');
    ids.add(entry.id);
    if(!Number.isInteger(entry.rank)||entry.rank<=0)throw new Error('Ranking de veículo inválido');
    if(!['available','blocked'].includes(entry.status))throw new Error('Estado de modelo inválido');
    if(entry.status==='blocked'&&Object.keys(entry.variants||{}).length)throw new Error('Modelo bloqueado não pode ter GLB');
    for(const [kind,variant] of Object.entries(entry.variants||{})){
      if(!['original','restored','repaired'].includes(kind)||!GIT_REF.test(variant.ref)||
         !FILE.test(variant.path)||!SHA.test(variant.sha256)||
         (variant.bytes!=null&&(!Number.isInteger(variant.bytes)||variant.bytes<=0||variant.bytes>MAX_BYTES)))
        throw new Error('Fonte de GLB inválida');
      if(kind==='original'&&!variant.path.startsWith('assets/'))throw new Error('Variante original fora de assets/');
      if(kind==='restored'&&!variant.path.startsWith('curadoria/restaurados/'))throw new Error('Variante restaurada fora da curadoria');
      if(kind==='repaired'&&(!/^curadoria\/(?:geometria|rodas-reparadas)\//.test(variant.path)||variant.experimental!==true))throw new Error('Rodas reparadas devem ser experimentais e vir da curadoria geométrica');
    }
  }
  return catalog;
}
validateCatalog(manifest);

export function resolveEntry(catalog,id,variant='original'){
  if(!SAFE_ID.test(String(id||''))||!['original','restored','repaired'].includes(variant))throw new Error('Modelo 3D indisponível');
  const item=catalog.models.find(x=>x.id===id);
  if(!item||item.status!=='available'||!item.variants?.[variant])
    throw new Error('Modelo 3D não encontrado ou indisponível para download');
  return {...item.variants[variant],id,variant};
}

export function assetUrl(entry){
  if(!GIT_REF.test(entry.ref)||!FILE.test(entry.path)||!SHA.test(entry.sha256))
    throw new Error('Fonte de modelo inválida');
  return 'https://raw.githubusercontent.com/'+OWNER+'/'+REPOSITORY+'/'+entry.ref+'/'+entry.path;
}

function filename(id,variant){
  if(!SAFE_ID.test(String(id||''))||!['original','restored','repaired'].includes(variant))
    throw new Error('Identificador de arquivo inválido');
  return id+'__'+variant+'.glb';
}
function fullPath(storageDir,id,variant){
  return join(resolve(storageDir),filename(id,variant));
}
function assertGlb(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<20||buffer.length>MAX_BYTES||
     buffer.toString('ascii',0,4)!=='glTF'||buffer.readUInt32LE(4)!==2||
     buffer.readUInt32LE(8)!==buffer.length||
     buffer.toString('ascii',16,20)!=='JSON')
    throw new Error('GLB inválido ou excede o limite de 25 MB');
}
function checkBuffer(buffer,entry){
  assertGlb(buffer);
  if(entry.bytes!=null&&buffer.length!==entry.bytes)throw new Error('Tamanho GLB divergente');
  if(createHash('sha256').update(buffer).digest('hex')!==entry.sha256)
    throw new Error('Falha de integridade SHA-256 do modelo 3D');
}

export function readInstalledAsset(storageDir,id,variant='original',{catalog=manifest}={}){
  const entry=resolveEntry(catalog,id,variant),path=fullPath(storageDir,id,variant);
  if(!existsSync(path))throw new Error('Modelo 3D não instalado');
  const bytes=readFileSync(path);
  checkBuffer(bytes,entry);
  return bytes;
}
export function listStatuses(storageDir,{catalog=manifest}={}){
  return catalog.models.map(item=>{
    const installed={};
    for(const variant of Object.keys(item.variants||{})){
      try{
        readInstalledAsset(storageDir,item.id,variant,{catalog});
        installed[variant]=true;
      }catch{installed[variant]=false}
    }
    return {id:item.id,installed};
  });
}
async function saveAtomic(storageDir,id,variant,buffer,entry){
  checkBuffer(buffer,entry);
  await mkdir(storageDir,{recursive:true});
  const path=fullPath(storageDir,id,variant);
  const tmp=path+'.'+randomUUID()+'.partial';
  try{
    await writeFile(tmp,buffer,{flag:'wx',mode:0o600});
    await rename(tmp,path);
  }finally{await unlink(tmp).catch(()=>{})}
  return {id,variant,installed:true,bytes:buffer.length,sha256:entry.sha256};
}

async function readResponse(response){
  if(!response?.ok)throw new Error('Falha ao baixar modelo 3D na origem');
  const length=Number(response.headers?.get?.('content-length')||0);
  if(length>MAX_BYTES)throw new Error('Modelo excede limite de 25 MB');
  if(response.body?.getReader){
    const reader=response.body.getReader(),parts=[];
    let size=0;
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        size+=value.byteLength;
        if(size>MAX_BYTES)throw new Error('Modelo excede limite de 25 MB');
        parts.push(Buffer.from(value));
      }
    }finally{reader.releaseLock()}
    return Buffer.concat(parts,size);
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>MAX_BYTES)throw new Error('Modelo excede limite de 25 MB');
  return bytes;
}

export async function installAsset(storageDir,id,variant='original',{catalog=manifest,fetchImpl=globalThis.fetch}={}){
  const entry=resolveEntry(catalog,id,variant);
  try{
    const cached=readInstalledAsset(storageDir,id,variant,{catalog});
    return {id,variant,installed:true,bytes:cached.length,alreadyInstalled:true};
  }catch{ /* Modelo ausente ou com SHA divergente: baixar de novo. */ }
  const key=resolve(storageDir)+'/'+filename(id,variant);
  if(inflight.has(key))return inflight.get(key);
  const pending=(async()=>{
    const response=await fetchImpl(assetUrl(entry),{signal:AbortSignal.timeout(120000)});
    const buffer=await readResponse(response);
    return saveAtomic(storageDir,id,variant,buffer,entry);
  })();
  inflight.set(key,pending);
  try{return await pending}finally{inflight.delete(key)}
}

export async function importLocalAsset(storageDir,id,variant,buffer,{catalog=manifest}={}){
  const entry=resolveEntry(catalog,id,variant);
  return saveAtomic(storageDir,id,variant,Buffer.from(buffer),entry);
}
