// Self-hosted, opt-in unified PostgreSQL gateway for P3/P4.
// It replaces SQLite for this process only; main/legacy entry points stay
// untouched until migration, restore and Windows E2E gates pass.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createCommonDataAdapter} from './platform/common-data-adapter.js';
import {createPostgresTenantRegistry} from './platform/async-postgres-registry.js';
import {createPostgresTenantRuntimeFactory} from './platform/postgres-tenant-runtime.js';
import {createPostgresUnifiedGateway} from './platform/postgres-unified-gateway.js';
import {loadTenantPaymentConfigs,resolveTenantPaymentOptions} from './platform/tenant-payment.js';
import {loadTenantAsaasConfigs,createTenantAsaasBillingProviders} from './platform/asaas-tenant-options.js';

const registryUrl=process.env.OFICINA_POSTGRES_REGISTRY_URL;
const operationsUrl=process.env.OFICINA_POSTGRES_OPERATIONS_URL;
if(!registryUrl||!operationsUrl)
 throw Error('O gateway exige URLs PostgreSQL explícitas de registry e operações; sem fallback SQLite');
let Pool;
try{({Pool}=await import('pg'));}catch{
 throw Error('Instale o driver open source pg@8 para executar o gateway PostgreSQL');
}
const registryPool=new Pool({connectionString:registryUrl,max:5,
  connectionTimeoutMillis:5000,idleTimeoutMillis:20000,statement_timeout:10000});
const host='127.0.0.1',port=Number(process.env.OFICINA_POSTGRES_PORT||3344);
if(!Number.isInteger(port)||port<1024||port>65535)
 throw Error('Porta PostgreSQL inválida');
const mime={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml',
 '.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2'
};
const publicRoot=resolve('public');
const securityHeaders={
 'x-content-type-options':'nosniff','x-frame-options':'DENY',
 'referrer-policy':'no-referrer',
 'content-security-policy':"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"
};
function respond(res,status,headers,body){
 res.writeHead(status,{...securityHeaders,'cache-control':'no-store',...headers});
 res.end(body);
}
async function staticAsset(url,res){
 let path;
 try{path=decodeURIComponent(url.pathname);}catch{
  return respond(res,400,{},'Invalid path');
 }
 if(path==='/'||path==='')path='/index.html';
 if(path.includes('\0')||path.includes('\\')||path.split('/').includes('..')||
    path.split('/').some(v=>v.startsWith('.')))
  return respond(res,403,{},'Forbidden');
 const file=resolve(publicRoot,'.'+path);
 if(!file.startsWith(publicRoot+sep))return respond(res,403,{},'Forbidden');
 if(!mime[extname(file).toLowerCase()])return respond(res,404,{},'Not found');
 try{
  const info=await stat(file);
  if(!info.isFile()||info.size>12*1024*1024)return respond(res,404,{},'Not found');
  return respond(res,200,{'content-type':mime[extname(file).toLowerCase()]},await readFile(file));
 }catch{return respond(res,404,{},'Not found');}
}
const tenantPaymentConfigs=loadTenantPaymentConfigs(process.env.TENANCY_PAYMENT_CONFIG_FILE);
const tenantAsaasConfigs=loadTenantAsaasConfigs(process.env.TENANCY_ASAAS_CONFIG_FILE);
let tenantFactory;
try{
 await registryPool.query('SELECT 1');
 const registry=createPostgresTenantRegistry(createCommonDataAdapter({
   engine:'postgres',pool:registryPool
 }));
 const fresh=process.env.OFICINA_REGISTRY_NEW_INSTALL==='true';
 await registry.initialize({allowBootstrap:fresh});
 const token=randomBytes(48).toString('base64url');
 tenantFactory=createPostgresTenantRuntimeFactory({
   Pool,connectionString:operationsUrl,registry,serviceToken:token,
   allowProvision:process.env.OFICINA_POSTGRES_PROVISION_NEW_UNITS==='true',
   schemaPrefix:process.env.OFICINA_POSTGRES_SCHEMA_PREFIX||'oficina',
   localStorageRoot:process.env.OFICINA_POSTGRES_STORAGE_ROOT||'./storage/postgres',
   paymentOptionsForUnit:(unit,port)=>({
     ...resolveTenantPaymentOptions(unit,tenantPaymentConfigs),
     billingProviders:createTenantAsaasBillingProviders(unit,tenantAsaasConfigs,port)
   })
 });
 const gateway=createPostgresUnifiedGateway({
   registry,tenantHandlerForUnit:tenantFactory.handlerForUnit,
   serviceToken:token,allowAdminBootstrap:fresh
 });
 const server=createServer(async(req,res)=>{
  const requestedHost=String(req.headers.host||'');
  if(!/^(?:localhost|127\.0\.0\.1|\[::1\]):[0-9]{2,5}$/.test(requestedHost))
   return respond(res,400,{},'Host inválido');
  let url;
  try{url=new URL(req.url||'/', 'http://'+requestedHost);}catch{
   return respond(res,400,{},'URL inválida');
  }
  if(!url.pathname.startsWith('/api/')){
   if(req.method!=='GET'&&req.method!=='HEAD')
    return respond(res,405,{},'Method not allowed');
   return staticAsset(url,res);
  }
  const max= /^\/api\/work-orders\/[1-9][0-9]*\/attachments$/.test(url.pathname)&&
    req.method==='POST'?7*1024*1024:1048576;
  const chunks=[];
  let bytes=0;
  try{
   for await(const item of req){
    bytes+=item.length;
    if(bytes>max)return respond(res,413,{},'Corpo excede limite');
    chunks.push(item);
   }
   const request=new Request(url,{
     method:req.method,headers:req.headers,
     ...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})
   });
   const reply=await gateway(request,{remoteAddress:req.socket.remoteAddress});
   const headers=Object.fromEntries(reply.headers.entries());
   return respond(res,reply.status,headers,req.method==='HEAD'?null:
     Buffer.from(await reply.arrayBuffer()));
  }catch(error){
   console.error('[postgres-unified]',req.method,url.pathname,error.message);
   return respond(res,503,{'content-type':'application/json'},
     JSON.stringify({error:'Gateway PostgreSQL indisponível'}));
  }
 });
 server.listen(port,host,()=>console.info('[postgres-unified] http://'+host+':'+port));
 let stopped=false;
 const stop=()=>{
  if(stopped)return;stopped=true;
  server.close(()=>void Promise.allSettled([tenantFactory.close(),registryPool.end()]));
 };
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}catch(error){
 if(tenantFactory)await tenantFactory.close();
 await registryPool.end();
 throw error;
}
