import {createHmac} from 'node:crypto';
import {mapLegacyNativeRoute} from './native-api-route-map.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
function serverEndpoint(backend){
 if(!backend||typeof backend.endpoint!=='string'||
    typeof backend.serviceToken!=='string'||backend.serviceToken.length<32)
  fail('Backend nativo não configurado',503);
 let url;try{url=new URL(backend.endpoint);}catch{fail('Endpoint do backend inválido',503);}
 const localhost=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if(!(['https:'].includes(url.protocol)||(url.protocol==='http:'&&localhost))||
    url.username||url.password||url.search||url.hash||url.pathname!=='/')
  fail('Backend nativo exige HTTPS ou loopback e endpoint raiz',503);
 return url;
}
function scopedToken(backend,globalToken){
 return createHmac('sha256',backend.serviceToken)
  .update('oficina-native-session/v1\0'+backend.companyId+'/'+backend.unitId+'\0'+globalToken)
  .digest('base64url');
}
export function createNativeApiBridge({fetchImpl=fetch}={}){
 if(typeof fetchImpl!=='function')throw Error('Transporte nativo inválido');
 return async function nativeApiBridge({
  backend,unit,user,globalToken,expiresAt,method,path,search='',body={},
  idempotencyKey=null
 }={}){
  const mapping=mapLegacyNativeRoute(method,path);
  if(!mapping)fail('Rota ainda não disponível no backend PostgreSQL/D1',501);
  if(!validId(unit?.id)||!validId(unit?.companyId)||
     Number(backend?.unitId)!==Number(unit.id)||
     Number(backend?.companyId)!==Number(unit.companyId))
   fail('Identidade do tenant não corresponde ao backend',403);
  if(!validId(user?.id)||typeof user.name!=='string'||!user.name.trim()||
     typeof globalToken!=='string'||globalToken.length<32)
   fail('Sessão global inválida',401);
  if(!mapping.roles.includes(unit.role))fail('Permissão insuficiente',403);
  const exp=Date.parse(expiresAt);
  if(!Number.isFinite(exp)||exp<=Date.now())fail('Sessão global expirada',401);
  const base=serverEndpoint(backend);
  const sessionToken=scopedToken(backend,globalToken);
  const commonHeaders={authorization:'Bearer '+backend.serviceToken,
    'content-type':'application/json'};
  const remoteFetch=async(url,options)=>{
   try{
     const response=await fetchImpl(url,{...options,redirect:'manual'});
     if(response.status>=300&&response.status<400)
       fail('Redirecionamento do backend nativo recusado',502);
     return response;
   }
   catch{fail('Backend nativo temporariamente indisponível',503);}
  };
  const auth=await remoteFetch(new URL('/v1/internal/gateway-session',base),{
   method:'POST',headers:commonHeaders,
   body:JSON.stringify({globalUserId:Number(user.id),name:user.name,
    role:unit.role,sessionToken,expiresAt}),
   signal:AbortSignal.timeout(15000)
  });
  if(!auth.ok)fail('Não foi possível validar o usuário no backend nativo',502);
  let input={};
  if(!['GET','HEAD'].includes(mapping.method)){
    if(body===null||typeof body!=='object'||Array.isArray(body))
      fail('Corpo JSON inválido');
    input=mapping.mapBody(body);
    // Global identity is authoritative; clients cannot forge native audit IDs.
    delete input.createdBy;delete input.changedBy;delete input.userRole;
    if(mapping.path.startsWith('/v1/technicians')&&input.userId!=null)
      fail('Vinculação de técnico ao usuário exige sincronização de cadastro',409);
    if(mapping.path.startsWith('/v1/sales/')&&mapping.path.endsWith('/cancel'))
      input.userId=2**52+Number(user.id);

    if(idempotencyKey&&typeof idempotencyKey==='string'&&
       /^[a-zA-Z0-9_:.-]{3,128}$/.test(idempotencyKey)&&!input.requestId)
      input.requestId=idempotencyKey;
    // Payments cannot be retried safely without a stable requestId.
    if(mapping.path==='/v1/payments'&&!input.requestId)
      fail('Recebimento exige requestId para evitar duplicidade',409);
  }
  const target=new URL(mapping.path+String(search||''),base);
  const headers={...commonHeaders,'x-oficina-session':sessionToken};
  const response=await remoteFetch(target,{
   method:mapping.method,headers,
   ...(['GET','HEAD'].includes(mapping.method)?{}:{body:JSON.stringify(input)}),
   signal:AbortSignal.timeout(30000)
  });
  const contentType=String(response.headers.get('content-type')||'');
  const status=response.status===201?200:response.status;
  if(contentType.includes('application/json')){
   let data;
   try{data=await response.json();}
   catch{fail('Backend nativo retornou JSON inválido',502);}
   return {status,body:data,contentType:'application/json; charset=utf-8'};
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  return {status,body:bytes,contentType:contentType||'application/octet-stream',
   disposition:response.headers.get('content-disposition')||null};
 };
}
