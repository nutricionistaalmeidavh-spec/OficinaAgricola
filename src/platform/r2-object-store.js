import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const maxBytes=5*1024*1024;
function scopedKey(companyId,unitId,key){
 const company=Number(companyId),unit=Number(unitId);
 if(!Number.isSafeInteger(company)||company<1||!Number.isSafeInteger(unit)||unit<1)
   throw Error('Empresa/unidade do objeto R2 inválida');
 const path=String(key||'');
 if(!/^[1-9]\d*\/[A-Za-z0-9_.-]{1,128}$/.test(path)||
   path.includes('..'))throw Error('Chave R2 inválida');
 return 'company-'+company+'/unit-'+unit+'/'+path;
}
/**
 * Optional Cloudflare R2 binding adapter. Uses exact same private object
 * interface as self-hosted MinIO/S3; never defaults to a paid provider.
 * Each key receives a namespace based exclusively on trusted server config.
 */
export function createR2ObjectStoreAdapter({bucket,companyId,unitId}={}){
 if(!bucket||typeof bucket.put!=='function'||typeof bucket.get!=='function'||
   typeof bucket.delete!=='function')
   throw Error('Bucket R2 privado não configurado');
 const filePath=key=>scopedKey(companyId,unitId,key);
 async function getObject({key,maxBytes:limit=maxBytes}={}){
   const path=filePath(key);
   const row=await bucket.get(path);
   if(!row)throw Error('Arquivo R2 indisponível');
   if(Number(row.size)>limit||Number(row.size)>maxBytes)
     throw Error('Arquivo R2 excede o limite');
   const content=Buffer.from(await row.arrayBuffer());
   if(content.length>limit||content.length>maxBytes)
     throw Error('Arquivo R2 excede o limite');
   const expected=row.customMetadata?.sha256;
   if(!/^[a-f0-9]{64}$/.test(String(expected||''))||sha(content)!==expected)
     throw Error('Falha de integridade SHA-256 do arquivo R2');
   return content;
 }
 async function putObject({key,data,mimeType='application/octet-stream'}={}){
   const path=filePath(key),bytes=Buffer.from(data||[]);
   if(!bytes.length||bytes.length>maxBytes)
     throw Error('Arquivo R2 vazio ou excede o limite');
   const digest=sha(bytes);
   await bucket.put(path,bytes,{
     httpMetadata:{contentType:mimeType},
     customMetadata:{sha256:digest}
   });
   const readBack=await getObject({key,maxBytes:bytes.length});
   if(readBack.length!==bytes.length)
     throw Error('R2 não confirmou tamanho do arquivo enviado');
   return {key,size:bytes.length,hash:digest};
 }
 async function deleteObject({key}={}){
   await bucket.delete(filePath(key));
   return {ok:true};
 }
 return Object.freeze({putObject,getObject,deleteObject});
}
