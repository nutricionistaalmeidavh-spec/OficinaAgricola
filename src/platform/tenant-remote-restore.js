import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { verifyBackup } from './backup.js';

const MAX_MANIFEST_BYTES=1024*1024;
const MAX_FILE_BYTES=128*1024*1024;
const MAX_TOTAL_BYTES=2*1024*1024*1024;
const MAX_FILES=10000;
const hash=data=>createHash('sha256').update(data).digest('hex');

function safeSegments(input,label){
  if(typeof input!=='string'||!input||input.length>1024||input.startsWith('/')||
      input.includes('\\')||/[\x00-\x1f\x7f]/.test(input))
    throw Error('Caminho de '+label+' inválido');
  const segments=input.split('/');
  if(segments.some(part=>!part||part==='.'||part==='..'||part.includes(':')))
    throw Error('Caminho de '+label+' inválido');
  return segments;
}
function validateRemoteManifest(value){
  if(!value||value.version!==1||!Array.isArray(value.files)||
      !value.files.length||value.files.length>MAX_FILES)
    throw Error('Manifesto remoto de backup inválido');
  let total=0;
  const paths=new Set();
  for(const entry of value.files){
    if(!entry||typeof entry!=='object')throw Error('Manifesto remoto inválido');
    const path=safeSegments(entry.path,'manifesto').join('/');
    if(path==='manifest.json'||paths.has(path))
      throw Error('Manifesto remoto possui caminho duplicado ou reservado');
    paths.add(path);
    if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>MAX_FILE_BYTES||
       !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw Error('Manifesto remoto contém tamanho ou SHA-256 inválido');
    total+=entry.size;
    if(total>MAX_TOTAL_BYTES)throw Error('Backup remoto ultrapassa limite de segurança');
  }
  if(!paths.has('database.sqlite'))throw Error('Manifesto remoto sem snapshot SQLite');
  return value;
}
/**
 * Downloads a selected versioned S3/MinIO/R2 backup to a *new isolated staging
 * directory* and verifies every byte against the corresponding manifest.
 *
 * It NEVER replaces a live registry/database or mutates the running service.
 * Restore must be performed offline, atomically, for all tenant/registry DBs.
 */
export async function restoreMirroredTenantBackup({client,remoteArchive,restoreRoot}={}){
  if(!client?.getObject)throw Error('Cliente S3 com leitura remota obrigatório');
  const prefix=safeSegments(remoteArchive,'arquivo remoto').join('/');
  if(typeof restoreRoot!=='string'||!restoreRoot.trim())
    throw Error('Diretório de quarentena de restore obrigatório');
  const root=resolve(restoreRoot);
  mkdirSync(root,{recursive:true,mode:0o700});
  const manifestRaw=await client.getObject({
    key:prefix+'/manifest.json',maxBytes:MAX_MANIFEST_BYTES
  });
  if(!Buffer.isBuffer(manifestRaw)||manifestRaw.length>MAX_MANIFEST_BYTES)
    throw Error('Manifesto remoto excede limite');
  let parsed;
  try{parsed=JSON.parse(manifestRaw.toString('utf8'));}
  catch{throw Error('Manifesto remoto não é JSON válido');}
  const manifest=validateRemoteManifest(parsed);
  const suffix=randomUUID();
  const stage=join(root,'.stage-'+suffix);
  const final=join(root,'verified-'+suffix);
  mkdirSync(stage,{mode:0o700});
  try{
    for(const entry of manifest.files){
      const parts=safeSegments(entry.path,'manifesto');
      const file=join(stage,...parts);
      const key=prefix+'/'+parts.join('/');
      mkdirSync(join(stage,...parts.slice(0,-1)),{recursive:true,mode:0o700});
      if(typeof client.downloadObject==='function'){
        // Streaming avoids loading entire SQLite snapshots into Node memory.
        await client.downloadObject({
          key,filePath:file,expectedSize:entry.size,expectedSha256:entry.sha256
        });
      }else{
        const data=await client.getObject({key,maxBytes:entry.size});
        if(!Buffer.isBuffer(data)||data.length!==entry.size||hash(data)!==entry.sha256)
          throw Error('Falha de integridade SHA-256 do backup remoto: '+entry.path);
        writeFileSync(file,data,{flag:'wx',mode:0o600});
      }
    }
    writeFileSync(join(stage,'manifest.json'),manifestRaw,{flag:'wx',mode:0o600});
    verifyBackup(stage);
    renameSync(stage,final);
    return {archivePath:final,manifest,filesRestored:manifest.files.length,
      sourceArchive:prefix,liveDataModified:false};
  }catch(error){
    rmSync(stage,{recursive:true,force:true});
    throw error;
  }
}
