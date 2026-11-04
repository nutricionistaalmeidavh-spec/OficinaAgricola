import {mkdir,realpath,open,stat,lstat,unlink} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {constants} from 'node:fs';

// Primary attachment storage at R$0: local filesystem, one namespace per
// company/unit. No S3/R2/MinIO account or token is required.
const keyPattern=/^[1-9][0-9]*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|pdf)$/;
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createLocalTenantObjectStore({root,companyId,unitId}={}){
 if(typeof root!=='string'||!root.trim()||!positive(companyId)||!positive(unitId))
   throw Error('Storage local exige diretório, empresa e unidade explícitos');
 const base=resolve(root),location=resolve(base,'company-'+companyId,'unit-'+unitId);
 async function safePath(key,{create=false}={}){
   if(typeof key!=='string'||!keyPattern.test(key))
     fail('Chave local de anexo inválida');
   const folder=resolve(location,key.split('/')[0]);
   if(!folder.startsWith(location+sep))fail('Chave fora do tenant',403);
   if(create)await mkdir(folder,{recursive:true,mode:0o700});
   let parent;
   try{parent=await realpath(folder);}catch{fail('Pasta do anexo inexistente',404);}
   const boundary=await realpath(location);
   if(!parent.startsWith(boundary+sep))fail('Anexo fora do tenant',403);
   const file=join(parent,key.split('/')[1]);
   return file;
 }
 async function putObject({key,data}={}){
   await mkdir(location,{recursive:true,mode:0o700});
   const file=await safePath(key,{create:true});
   const bytes=Buffer.from(data??[]);
   if(!bytes.length||bytes.length>5*1024*1024)fail('Tamanho inválido de anexo');
   const flags=constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0);
   const descriptor=await open(file,flags,0o600);
   try{
     await descriptor.writeFile(bytes);
     await descriptor.sync();
   }catch(error){
     await descriptor.close();
     await unlink(file).catch(()=>{});
     throw error;
   }
   await descriptor.close();
   return {key,sizeBytes:bytes.length};
 }
 async function getObject({key,maxBytes=5*1024*1024}={}){
   const file=await safePath(key);
   const meta=await lstat(file);
   if(!meta.isFile()||meta.isSymbolicLink()||meta.size>Math.min(maxBytes,5*1024*1024))
     fail('Anexo local inválido',409);
   const fd=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   try{
     const info=await fd.stat();
     if(!info.isFile()||info.size!==meta.size)fail('Anexo local alterado durante leitura',409);
     const bytes=await fd.readFile();
     if(bytes.length!==info.size)fail('Anexo local incompleto',409);
     return bytes;
   }finally{await fd.close();}
 }
 async function deleteObject({key}={}){
   const file=await safePath(key);
   await unlink(file).catch(error=>{
     if(error.code!=='ENOENT')throw error;
   });
   return {ok:true};
 }
 return Object.freeze({kind:'local',putObject,getObject,deleteObject});
}
