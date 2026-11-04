import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream, openSync, rmSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve, relative, join, sep } from 'node:path';
import { verifyBackup } from './backup.js';

const sha256=data=>createHash('sha256').update(data).digest('hex');
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest();
const safeKeyPart=value=>encodeURIComponent(value).replace(/[!'()*]/g,chr=>'%'+chr.charCodeAt(0).toString(16).toUpperCase());
const secureLocalHost=host=>new Set(['localhost','127.0.0.1','[::1]']).has(host);
const objectKey=segments=>segments.map(safeKeyPart).join('/');
const splitKey=value=>{
  const pieces=String(value||'').split('/');
  if(!pieces.length||pieces.some(s=>!s||s==='.'||s==='..'||s.includes('\\')||s.includes('\0')))
    throw Error('Chave de backup S3 inválida');
  return pieces;
};
async function hashFile(path){
  const stream=createReadStream(path),hash=createHash('sha256');
  for await(const chunk of stream)hash.update(chunk);
  return hash.digest('hex');
}
/**
 * S3 Signature V4 client for private MinIO or optional R2 backup archives.
 * Zero extra NPM dependencies. Configured only with explicit environment vars.
 * This is backup replication, NOT a primary upload/attachment backend.
 */
export function createS3BackupClient({
  endpoint,bucket,region='us-east-1',accessKeyId,secretAccessKey,prefix='oficina-backups',
  httpFetch=fetch
}={}){
  let base;
  try{base=new URL(String(endpoint||''));}
  catch{throw Error('Endpoint S3 inválido');}
  if(!['https:','http:'].includes(base.protocol)||base.username||base.password||
     base.search||base.hash||base.pathname!=='/' )
    throw Error('Endpoint S3 inválido: use somente origem HTTPS sem path, query ou credenciais');
  if(base.protocol==='http:'&&!secureLocalHost(base.hostname))
    throw Error('Backup S3 requer HTTPS fora de localhost');
  if(!bucket||!/^[-a-z0-9.]{3,63}$/.test(String(bucket)))
    throw Error('Bucket S3 inválido');
  if(!region||!/^[A-Za-z0-9-]{2,50}$/.test(String(region)))
    throw Error('Região S3 inválida');
  if(!accessKeyId||!secretAccessKey)throw Error('Credenciais S3 do backup ausentes');
  const namespace=splitKey(prefix);
  const bucketName=String(bucket);
  const urlFor=key=>{
    const segments=[bucketName,...namespace,...splitKey(key)];
    const path='/'+objectKey(segments);
    return {url:new URL(path,base),path};
  };
  function signedHeaders({method,path,payloadHash,metadataHash=null,at=new Date()}){
    const timestamp=at.toISOString().replace(/[-:]|\.\d{3}/g,'');
    const date=timestamp.slice(0,8);
    const headers={
      host:base.host,
      'x-amz-content-sha256':payloadHash,
      'x-amz-date':timestamp
    };
    if(metadataHash)headers['x-amz-meta-sha256']=metadataHash;
    const names=Object.keys(headers).sort();
    const canonical=names.map(k=>k+':'+headers[k].trim()+'\n').join('');
    const signed=names.join(';');
    const request=[method,path,'',canonical,signed,payloadHash].join('\n');
    const scope=date+'/'+region+'/s3/aws4_request';
    const stringToSign=['AWS4-HMAC-SHA256',timestamp,scope,sha256(request)].join('\n');
    const key=hmac(hmac(hmac(hmac('AWS4'+secretAccessKey,date),region),'s3'),'aws4_request');
    const signature=createHmac('sha256',key).update(stringToSign).digest('hex');
    return {
      'x-amz-content-sha256':payloadHash,
      'x-amz-date':timestamp,
      ...(metadataHash?{'x-amz-meta-sha256':metadataHash}:{}),
      Authorization:'AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+
        ', SignedHeaders='+signed+', Signature='+signature
    };
  }
  async function putFile({filePath,key}){
    const {url,path}=urlFor(key);
    const size=statSync(filePath).size;
    const hash=await hashFile(filePath);
    const remoteMatches=async()=>{
      const head=await httpFetch(url,{
        method:'HEAD',headers:signedHeaders({method:'HEAD',path,payloadHash:sha256('')}),
        redirect:'error'
      });
      if(head.status===404)return false;
      if(!head.ok)throw Error('Falha ao consultar backup remoto (HTTP '+head.status+')');
      return head.headers.get('x-amz-meta-sha256')===hash&&
        Number(head.headers.get('content-length'))===size;
    };
    // Avoid costly writes on the hourly retry if this immutable backup
    // already exists remotely with the expected SHA-256 and exact size.
    if(await remoteMatches())return {key,payloadSha256:hash,size,alreadyPresent:true};
    const body=createReadStream(filePath);
    let response;
    try{
      response=await httpFetch(url,{
        method:'PUT',headers:{...signedHeaders({method:'PUT',path,payloadHash:hash,metadataHash:hash}),'Content-Length':String(size)},
        body,duplex:'half',redirect:'error'
      });
    }finally{body.destroy();}
    if(!response.ok)throw Error('Falha no upload do backup S3 (HTTP '+response.status+')');
    if(!await remoteMatches())
      throw Error('Integridade do backup remoto não confirmada pelo storage');
    return {key,payloadSha256:hash,size,alreadyPresent:false};
  }
  async function putObject({key,data,mimeType='application/octet-stream'}){
    const bytes=Buffer.from(data||[]);
    if(!bytes.length||bytes.length>5*1024*1024)throw Error('Arquivo remoto excede limite ou está vazio');
    const hash=sha256(bytes);
    const {url,path}=urlFor(key);
    const response=await httpFetch(url,{method:'PUT',redirect:'error',
      headers:{
        ...signedHeaders({method:'PUT',path,payloadHash:hash,metadataHash:hash}),
        'Content-Length':String(bytes.length),'Content-Type':mimeType
      },body:bytes
    });
    if(!response.ok)throw Error('S3 não confirmou upload remoto (HTTP '+response.status+')');
    const check=await httpFetch(url,{method:'HEAD',redirect:'error',
      headers:signedHeaders({method:'HEAD',path,payloadHash:sha256('')})
    });
    if(!check.ok||check.headers.get('x-amz-meta-sha256')!==hash||
      Number(check.headers.get('content-length'))!==bytes.length)
      throw Error('S3 não confirmou integridade do objeto enviado');
    return {key,size:bytes.length,hash};
  }
  async function getObject({key,maxBytes=5*1024*1024}){
    const {url,path}=urlFor(key);
    const response=await httpFetch(url,{method:'GET',redirect:'error',
      headers:signedHeaders({method:'GET',path,payloadHash:sha256('')})
    });
    if(!response.ok)throw Error('Arquivo remoto indisponível (HTTP '+response.status+')');
    if(Number(response.headers.get('content-length'))>maxBytes)
      throw Error('Arquivo remoto excede limite');
    const chunks=[];let size=0;
    for await(const chunk of response.body||[]){
      size+=chunk.length;
      if(size>maxBytes){
        await response.body?.cancel?.().catch(()=>{});
        throw Error('Arquivo remoto excede limite');
      }
      chunks.push(Buffer.from(chunk));
    }
    const bytes=Buffer.concat(chunks);
    const expected=response.headers.get('x-amz-meta-sha256');
    if(!expected||expected!==sha256(bytes))
      throw Error('Integridade SHA-256 do objeto remoto não confirmada');
    return bytes;
  }
  async function downloadObject({key,filePath,expectedSize,expectedSha256}={}){
    if(!Number.isSafeInteger(expectedSize)||expectedSize<0||
       !/^[a-f0-9]{64}$/.test(String(expectedSha256||'')))
      throw Error('Tamanho ou SHA-256 esperado do backup inválido');
    const {url,path}=urlFor(key);
    const response=await httpFetch(url,{method:'GET',redirect:'error',
      headers:signedHeaders({method:'GET',path,payloadHash:sha256('')})
    });
    if(!response.ok)throw Error('Objeto de backup remoto indisponível (HTTP '+response.status+')');
    const length=response.headers.get('content-length');
    if(length!==null&&Number(length)!==expectedSize)
      throw Error('Tamanho de backup remoto diverge do manifesto');
    const metadata=response.headers.get('x-amz-meta-sha256');
    if(metadata&&metadata!==expectedSha256)
      throw Error('Integridade SHA-256 do backup remoto diverge do manifesto');
    if(!response.body)throw Error('Resposta de backup remoto sem corpo');
    // The file is created EXCLUSIVELY. Never truncate a pre-existing backup.
    const fd=openSync(filePath,'wx',0o600);
    const digest=createHash('sha256');
    let bytes=0;
    try{
      await pipeline(response.body,async function* verifyChunks(source){
        for await(const chunk of source){
          bytes+=chunk.length;
          if(bytes>expectedSize)throw Error('Backup remoto excede tamanho do manifesto');
          digest.update(chunk);
          yield chunk;
        }
      },createWriteStream(filePath,{fd,autoClose:true}));
      if(bytes!==expectedSize||digest.digest('hex')!==expectedSha256)
        throw Error('Falha de integridade SHA-256 do backup remoto');
      return {key,size:bytes,sha256:expectedSha256,filePath};
    }catch(error){
      rmSync(filePath,{force:true});
      throw error;
    }
  }
  async function deleteObject({key}){
    const {url,path}=urlFor(key);
    const response=await httpFetch(url,{method:'DELETE',redirect:'error',
      headers:signedHeaders({method:'DELETE',path,payloadHash:sha256('')})
    });
    if(!response.ok&&response.status!==404)
      throw Error('Falha ao remover objeto remoto (HTTP '+response.status+')');
    return {deleted:true};
  }
  return Object.freeze({putFile,putObject,getObject,downloadObject,deleteObject});
}
function safeArchiveFile(archive,relPath){
  const parts=splitKey(relPath);
  let current=archive;
  for(const part of parts){
    current=join(current,part);
    if(lstatSync(current).isSymbolicLink())
      throw Error('Backup contém link simbólico e não pode ser espelhado remotamente');
  }
  if(!lstatSync(current).isFile())
    throw Error('Backup contém objeto não regular');
  const root=realpathSync(archive),real=realpathSync(current);
  if(!real.startsWith(root+sep))
    throw Error('Backup aponta para arquivo fora do diretório permitido');
  return current;
}
/**
 * Upload immutable verified snapshots. Manifest is always published LAST,
 * so a partial attempt is never advertised as a completed remote backup.
 */
export async function mirrorVerifiedTenantBackups({records,backupRoot,client}){
  if(!client?.putFile)throw Error('Cliente remoto S3 indisponível');
  const base=resolve(backupRoot),mirrored=[];
  for(const record of records||[]){
    if(!record.verified||!record.backupDir||record.skipped)continue;
    const archive=resolve(record.backupDir);
    const rel=relative(base,archive);
    if(!rel||rel==='..'||rel.startsWith('..'+sep)||rel.startsWith(sep))
      throw Error('Backup fora da raiz permitida');
    const rootReal=realpathSync(base),archiveReal=realpathSync(archive);
    if(!archiveReal.startsWith(rootReal+sep)||lstatSync(archive).isSymbolicLink())
      throw Error('Backup fora da raiz de armazenamento permitida');
    const manifest=verifyBackup(archive);
    const keyRoot=rel.split(sep).join('/');
    for(const item of manifest.files){
      const fragments=splitKey(item.path);
      await client.putFile({
        filePath:safeArchiveFile(archive,fragments.join('/')),
        key:keyRoot+'/'+fragments.join('/')
      });
    }
    await client.putFile({filePath:safeArchiveFile(archive,'manifest.json'),key:keyRoot+'/manifest.json'});
    mirrored.push({archive:keyRoot,files:manifest.files.length+1});
  }
  return mirrored;
}
