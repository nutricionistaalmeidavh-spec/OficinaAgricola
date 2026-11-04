import {createHmac} from 'node:crypto';
import {mapLegacyNativeRoute} from './native-api-route-map.js';
import {createPostgresRegistryControlHandler} from './postgres-registry-control.js';
import {readPostgresSessionToken,assertPostgresSameOrigin} from './postgres-session-transport.js';

// Single PostgreSQL HTTP API for existing /api routes.
// Auth and membership stay in the PostgreSQL global registry; each operational
// handler runs against a separately initialized and identity-locked tenant store.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200)=>Response.json(data,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'
}});
const controlPaths=new Set([
 '/api/health','/api/setup/status','/api/setup/initialize',
 '/api/auth/login','/api/auth/logout','/api/auth/me',
 '/api/tenancy/context','/api/tenancy/companies',
 '/api/tenancy/units','/api/tenancy/memberships','/api/tenancy/audit',
 '/api/users','/api/units'
]);
const isControl=path=>controlPaths.has(path)||/^\/api\/users\/[1-9][0-9]*$/.test(path);
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
async function readPayload(request,limit){
 const ct=String(request.headers.get('content-type')??'').toLowerCase();
 if(!ct.startsWith('application/json'))fail('JSON obrigatório',415);
 if(Number(request.headers.get('content-length')||0)>limit)fail('Requisição muito grande',413);
 const raw=await request.text();
 if(Buffer.byteLength(raw,'utf8')>limit)fail('Requisição muito grande',413);
 if(!raw)return {};
 let value;
 try{value=JSON.parse(raw);}catch{fail('JSON inválido',400);}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Objeto JSON obrigatório',400);
 return value;
}
function sessionForUnit(secret,unit,token){
 return createHmac('sha256',secret)
   .update('oficina-native-session/v1\0'+unit.companyId+'/'+unit.id+'\0'+token)
   .digest('base64url');
}
async function dispatchNative(handler,path,{method='GET',session,body,search='',serviceToken}={}){
 const options={method,headers:{
   authorization:'Bearer '+serviceToken,
   'content-type':'application/json',
   ...(session?{'x-oficina-session':session}:{})
 }};
 if(!['GET','HEAD'].includes(method))options.body=JSON.stringify(body??{});
 const result=await handler(new Request('http://127.0.0.1'+path+search,options));
 if(!(result instanceof Response))fail('Resposta nativa inválida',502);
 return result;
}
function safeNativeResponse(reply){
 const headers=new Headers({'cache-control':'no-store','x-content-type-options':'nosniff'});
 for(const key of ['content-type','content-disposition','content-length'])
   if(reply.headers.has(key))headers.set(key,reply.headers.get(key));
 return new Response(reply.body,{status:reply.status===201?200:reply.status,headers});
}
export function createPostgresUnifiedGateway({
 registry,tenantHandlerForUnit,serviceToken,allowAdminBootstrap=false
}={}){
 if(!registry||typeof registry.validateSession!=='function'||
    typeof registry.requireUnitMembership!=='function'||
    typeof registry.listUserUnits!=='function')
   throw Error('Gateway PostgreSQL exige registry de sessões e RBAC');
 if(typeof tenantHandlerForUnit!=='function'||typeof serviceToken!=='string'||serviceToken.length<32)
   throw Error('Gateway exige fábrica por tenant e token privado de serviço');
 const control=createPostgresRegistryControlHandler({registry,allowAdminBootstrap});
 return async function gateway(request,options={}){
  try{
   assertPostgresSameOrigin(request);
   const u=new URL(request.url),path=u.pathname,method=request.method.toUpperCase();
   if(isControl(path))return control(request,options);
   if(!path.startsWith('/api/'))return json({error:'Rota não encontrada'},404);
   // Public approval links, transfers and command reconciliation must be
   // migrated explicitly. None may fall back to a legacy SQLite service.
   const token=readPostgresSessionToken(request);
   if(!token)fail('Sessão inválida',401);
   const actor=await registry.validateSession(token);
   if(!validId(actor.id))fail('Sessão inválida',401);
   const units=await registry.listUserUnits(actor.id);
   if(!units.length)fail('Permissão: usuário sem vínculo',403);
   const selected=request.headers.get('x-oficina-unit');
   let unit;
   if(selected===null||selected===''){
     if(units.length!==1)fail('Selecione uma oficina para continuar',409);
     unit=await registry.requireUnitMembership(actor.id,units[0].id);
   }else{
     if(!/^[1-9][0-9]*$/.test(selected)||!validId(selected))
       fail('Unidade inválida',400);
     unit=await registry.requireUnitMembership(actor.id,Number(selected));
   }
   if(!validId(unit.id)||!validId(unit.companyId))fail('Vínculo da unidade inválido',403);
   const mapping=mapLegacyNativeRoute(method,path);
   if(!mapping)fail('Rota não migrada para PostgreSQL',501);
   if(!mapping.roles.includes(unit.role))fail('Permissão insuficiente',403);
   const runtime=await tenantHandlerForUnit(unit);
   const handler=typeof runtime==='function'?runtime:runtime?.handler;
   if(typeof handler!=='function')fail('Backend de unidade indisponível',503);
   if(typeof runtime==='object'&&runtime!==null&&(
      (runtime.unitId!=null&&Number(runtime.unitId)!==Number(unit.id))||
      (runtime.companyId!=null&&Number(runtime.companyId)!==Number(unit.companyId))))
     fail('Identidade do backend não corresponde à unidade',403);
   const personalToken=sessionForUnit(serviceToken,unit,token);
   // User identity, role and expiry are set by a trusted registry, never by
   // headers or body submitted by the browser.
   const provisioned=await dispatchNative(handler,'/v1/internal/gateway-session',{
      method:'POST',serviceToken,body:{
       globalUserId:actor.id,name:actor.name,role:unit.role,
       sessionToken:personalToken,
       expiresAt:new Date(Date.now()+60_000).toISOString()
      }
   });
   if(!provisioned.ok)fail('Sessão da unidade não pôde ser validada',502);
   let input={};
   if(!['GET','HEAD'].includes(method)){
     const upload=method==='POST'&&/^\/api\/work-orders\/[1-9][0-9]*\/attachments$/.test(path);
     input=mapping.mapBody(await readPayload(request,upload?7*1024*1024:1048576));
     // All audit identities are derived from the validated registry session.
     delete input.createdBy;delete input.changedBy;delete input.userRole;
     if(mapping.path.startsWith('/v1/technicians')&&input.userId!=null)
       fail('Vinculação de técnico exige sincronização segura',409);
     if(/^\/v1\/sales\/[1-9][0-9]*\/cancel$/.test(mapping.path))
       input.userId=2**52+Number(actor.id);
     const idem=request.headers.get('idempotency-key');
     if(idem&&/^[A-Za-z0-9_:.-]{3,128}$/.test(idem)&&!input.requestId)
       input.requestId=idem;
     if(mapping.path==='/v1/payments'&&!input.requestId)
       fail('Recebimento exige requestId',409);
   }
   const native=await dispatchNative(handler,mapping.path,{
     method,session:personalToken,search:u.search,body:input,serviceToken
   });
   return safeNativeResponse(native);
  }catch(error){
   const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<600
     ?error.status:503;
   return json({error:status===503||status===502?'Serviço PostgreSQL temporariamente indisponível':error.message},status);
  }
 };
}
