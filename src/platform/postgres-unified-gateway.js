import {requestPayloadLimit} from './billing-http-limits.js';
import {journalEligible} from './postgres-command-journal.js';
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
async function dispatchNative(handler,path,{method='GET',session,body,search='',serviceToken,commandScope=null,commandId=null}={}){
 const options={method,headers:{
   authorization:'Bearer '+serviceToken,
   'content-type':'application/json',
   ...(session?{'x-oficina-session':session}:{}),
   ...(commandScope?{'x-oficina-command-scope':commandScope}:{}),
   ...(commandId?{'x-oficina-command-id':commandId}:{})
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
   if(path==='/api/health'&&method==='GET')
     return json({ok:true,engine:'postgres',operationalApiReady:true});
   if(isControl(path))return control(request,options);
   if(!path.startsWith('/api/'))return json({error:'Rota não encontrada'},404);
   const approval=path.match(/^\/api\/public\/approval\/([a-f0-9]{64})$/);
   if(approval){
     if(!['GET','POST'].includes(method))fail('Método inválido',405);
     const requestedUnit=u.searchParams.get('unit');
     if(!requestedUnit||!/^[1-9][0-9]*$/.test(requestedUnit)||
        !validId(requestedUnit))fail('Unidade do link inválida',400);
     const publicUnit=await registry.getPublicUnit(Number(requestedUnit));
     const backend=await tenantHandlerForUnit(publicUnit);
     const handler=typeof backend==='function'?backend:backend?.handler;
     if(typeof handler!=='function')fail('Unidade indisponível',503);
     const data=method==='POST'?await readPayload(request,16384):{};
     const answer=await dispatchNative(handler,'/v1/public/approval/'+approval[1],{
       method,serviceToken,body:data
     });
     return safeNativeResponse(answer);
   }
   // Public approval links, transfers and command reconciliation must be
   // migrated explicitly. None may fall back to a legacy SQLite service.
   const token=readPostgresSessionToken(request);
   if(!token)fail('Sessão inválida',401);
   const actor=await registry.validateSession(token);
   if(!validId(actor.id))fail('Sessão inválida',401);

   if(path==='/api/tenancy/company-summary'&&method==='GET'){
     const companyId=Number(u.searchParams.get('companyId'));
     if(!validId(companyId))fail('Empresa inválida',400);
     const date=(key,fallback)=>{
       const raw=u.searchParams.get(key);
       if(raw===null)return fallback;
       if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)||
          !Number.isFinite(Date.parse(raw)))fail('Data '+key+' inválida: use UTC ISO 8601',400);
       return new Date(raw).toISOString();
     };
     const from=date('from','1970-01-01T00:00:00.000Z');
     const to=date('to','2999-12-31T23:59:59.999Z');
     if(from>to)fail('Período inválido',400);
     const members=await registry.listCompanyUnits(actor.id,companyId);
     const perUnit=await Promise.all(members.map(async item=>{
       const runtime=await tenantHandlerForUnit(item),port=runtime.port;
       if(!port||!runtime.services)fail('Operações PostgreSQL indisponíveis',503);
       const [a,b,d,e,finance]=await Promise.all([
         port.first('SELECT COUNT(*) n FROM customers WHERE active=1'),
         port.first('SELECT COUNT(*) n FROM work_orders'),
         port.first("SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','TRANSFERIDA')"),
         port.first('SELECT COUNT(*) n FROM parts WHERE active=1'),
         runtime.services.financeSummary({from,to})
       ]);
       return {id:item.id,code:item.code,name:item.name,
         customers:Number(a.n),workOrders:Number(b.n),openOrders:Number(d.n),
         parts:Number(e.n),finance};
     }));
     const money=['invoicedCents','receivedCents','pendingCents','expensesCents','resultCents'];
     const totals=perUnit.reduce((sum,item)=>{
       sum.customers+=item.customers;sum.workOrders+=item.workOrders;
       sum.openOrders+=item.openOrders;sum.parts+=item.parts;
       for(const key of money)sum.finance[key]+=Number(item.finance[key]??0);
       return sum;
     },{customers:0,workOrders:0,openOrders:0,parts:0,
       finance:Object.fromEntries(money.map(key=>[key,0]))});
     return json({companyId,period:{from,to},units:perUnit,totals,
       scope:'company-only-canonical-finance'});
   }
   if(method==='GET'&&(path==='/api/tenancy/shareable-customers'||
     path==='/api/tenancy/shareable-parts')){
     const sourceId=Number(u.searchParams.get('unitId'));
     if(!validId(sourceId))fail('Unidade inválida',400);
     const source=await registry.requireUnitMembership(actor.id,sourceId);
     if(source.role!=='ADMIN')fail('Administração da unidade necessária',403);
     const search=String(u.searchParams.get('search')??'').trim();
     if(search.length>80)fail('Busca excede 80 caracteres',400);
     const runtime=await tenantHandlerForUnit(source);
     if(!runtime.port)fail('Banco PostgreSQL indisponível',503);
     const pattern='%'+search+'%';
     if(path.endsWith('shareable-customers'))
       return json({customers:await runtime.port.all(
         'SELECT id,name FROM customers WHERE active=1 AND name ILIKE ? ORDER BY id DESC LIMIT 100',
         [pattern]),limit:100});
     return json({parts:await runtime.port.all(
       'SELECT id,sku,description,unit,quantity FROM parts WHERE active=1 AND (sku ILIKE ? OR description ILIKE ?) ORDER BY id DESC LIMIT 100',
       [pattern,pattern]),limit:100});
   }
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
   if(path==='/api/commands/status'&&method==='GET'){
     const queriedMethod=u.searchParams.get('method')||'';
     const queriedPath=u.searchParams.get('path')||'';
     const key=u.searchParams.get('requestId')||'';
     if(!journalEligible(queriedMethod,queriedPath)||
        !/^[A-Za-z0-9_:.-]{3,128}$/.test(key))
       fail('Consulta de operação inválida',400);
     const runtime=await tenantHandlerForUnit(unit);
     if(typeof runtime?.commandStatus!=='function')
       fail('Journal PostgreSQL indisponível',503);
     return json(await runtime.commandStatus(
       'http:'+queriedMethod+':'+queriedPath+':user:'+actor.id,key));
   }
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
     input=mapping.mapBody(await readPayload(request,requestPayloadLimit(method,path)));
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
   const journalKey=journalEligible(method,path)&&typeof input.requestId==='string'&&
      /^[A-Za-z0-9_:.-]{3,128}$/.test(input.requestId)?input.requestId:null;
   const native=await dispatchNative(handler,mapping.path,{
     method,session:personalToken,search:u.search,body:input,serviceToken,
     commandId:journalKey,
     commandScope:journalKey?'http:'+method+':'+path+':user:'+actor.id:null
   });
   if(mapping.path.endsWith('/quote/approval-link')&&native.ok){
     const result=await native.json();
     if(!/^\/approval\.html\?token=[a-f0-9]{64}$/.test(result?.path??''))
       fail('Link de aprovação retornado inválido',502);
     return json({...result,path:result.path+'&unit='+unit.id},200);
   }
   return safeNativeResponse(native);
  }catch(error){
   const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<600
     ?error.status:503;
   return json({error:status===503||status===502?'Serviço PostgreSQL temporariamente indisponível':error.message},status);
  }
 };
}
