import {normalizePublicOrigin,workshopRequestUrl} from './platform/public-access.js';
import {requestPayloadLimit} from './platform/billing-http-limits.js';
import {fileURLToPath} from 'node:url';
// Backend canônico PostgreSQL. Sem SQLite ou fallback para o runtime do Oficina.
// Self-hosted R$0; PostgreSQL embarcado no instalador Windows.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createCommonDataAdapter} from './platform/common-data-adapter.js';
import {createPostgresTenantRegistry} from './platform/async-postgres-registry.js';
import {createPostgresTenantRuntimeFactory} from './platform/postgres-tenant-runtime.js';
import {createPostgresUnifiedGateway} from './platform/postgres-unified-gateway.js';
import {createOficinaCommercialLicense} from './platform/commercial-license.js';
import {loadTenantPaymentConfigs,resolveTenantPaymentOptions} from './platform/tenant-payment.js';
import {loadTenantReminderSenders} from './platform/tenant-reminder-smtp.js';
import {loadTenantFiscalConfigs,resolveTenantFiscalProvider} from './platform/tenant-fiscal.js';
import {createAcbrLibFiscalProvider} from './platform/acbrlib-fiscal-provider.js';
import {createNationalNfseProvider} from './platform/nfse-national-provider.js';
import {selectManagedFiscalEngine} from './platform/nfse-national-provider-selection.js';
import {createLocalFiscalCertificateStore} from './platform/fiscal-certificate-store.js';

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
const publicOrigin=normalizePublicOrigin(process.env.OFICINA_PUBLIC_ORIGIN);
const host='127.0.0.1',port=Number(process.env.OFICINA_POSTGRES_PORT||3344);
if(!Number.isInteger(port)||port<1024||port>65535)
 throw Error('Porta PostgreSQL inválida');
const mime={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml',
 '.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2'
};
const publicRoot=resolve(fileURLToPath(new URL('../public',import.meta.url)));
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
const reminderSenderForUnit=loadTenantReminderSenders(process.env.TENANCY_REMINDER_SMTP_CONFIG_FILE);

const tenantFiscalConfigs=loadTenantFiscalConfigs(process.env.TENANCY_FISCAL_CONFIG_FILE);
function fiscalProviderForUnit(unit){
  // Explicit company-level fiscal configuration is opt-in. Never inherit an
  // issuer's credentials, fiscal provider or CNPJ from another company.
  if(Object.hasOwn(tenantFiscalConfigs,String(unit.companyId)))
    return resolveTenantFiscalProvider({companyId:unit.companyId,configs:tenantFiscalConfigs});
  // The bundled ACBr is already verified by the Electron bootstrap. For other
  // PostgreSQL deployments no fiscal adapter is enabled implicitly.
  if(process.env.OFICINA_POSTGRES_MANAGED_LOCAL!=='true'||
      process.env.OFICINA_BUNDLED_FISCAL_VERIFIED!=='true'||
      !process.env.FISCAL_ACBR_WORKER_EXE||
      !process.env.FISCAL_ACBR_INPUT_DIR)return null;
  const companyId=Number(unit.companyId),unitId=Number(unit.id);
  if(!Number.isSafeInteger(companyId)||companyId<=0||
      !Number.isSafeInteger(unitId)||unitId<=0)
    throw Error('Identidade fiscal da unidade inválida');
  const privateRoot=join(resolve(process.env.FISCAL_ACBR_INPUT_DIR),
    'empresa-'+companyId+'-unidade-'+unitId);
  const configDir=join(privateRoot,'config'),inputDir=join(privateRoot,'entrada');
  mkdirSync(configDir,{recursive:true,mode:0o700});
  mkdirSync(inputDir,{recursive:true,mode:0o700});
  const privateIni=name=>{
    const target=join(configDir,name);
    if(!existsSync(target)){
      // Criar apenas o modelo vazio da unidade. Nunca copiar um INI com
      // certificado/senha de outra unidade ou da configuração global.
      try{writeFileSync(target,'[Principal]\nLogNivel=0\n',{flag:'wx',mode:0o600})}
      catch(error){if(error.code!=='EEXIST')throw error}
    }
    return target;
  };
  const nfeLib=process.env.FISCAL_ACBR_NFE_LIB||null;
  const nfseLib=process.env.FISCAL_ACBR_NFSE_LIB||null;
  if(!nfeLib&&!nfseLib)return null;
  const certificateStore=createLocalFiscalCertificateStore({directory:join(privateRoot,'segredos')});
  const acbr=createAcbrLibFiscalProvider({
    nfeLib,nfseLib,workerExe:process.env.FISCAL_ACBR_WORKER_EXE,inputDir,
    certificateStore,
    // A biblioteca NFSe integrada usa o canal nacional; rotas municipais exigem
    // configuração isolada específica da empresa, nunca fallback silencioso.
    ...(nfseLib?{nfseChannel:'NACIONAL'}:{}),
    ...(nfeLib?{nfeConfig:privateIni('ACBrLibNFe.ini')}:{}),
    ...(nfseLib?{nfseConfig:privateIni('ACBrLibNFSe.ini')}:{})
  });
  // A1 habilita API nacional direta no modelo NFS-e, sem exigir flag técnica.
  // A3 mantém ACBr; configurações explícitas por empresa têm precedência acima.
  const national=createNationalNfseProvider({certificateStore,inputDir});
  const select=(kind,providerName)=>selectManagedFiscalEngine({
    kind,providerName,certificateType:certificateStore.status().certificateType
  })==='nacional'?national:acbr;
  const service=method=>async args=>{
    const target=select(args?.document?.kind,args?.document?.provider_name);
    if(typeof target?.[method]!=='function')
      throw Error('Operação fiscal não habilitada para este emissor');
    return target[method](args);
  };
  return Object.freeze({...acbr,
    nfseChannel:'NACIONAL',
    nameForKind:kind=>select(kind).name,
    nameForDocument:document=>select(document?.kind,document?.provider_name).name,
    prepare:service('prepare'),transmit:service('transmit'),
    consult:service('consult'),printPdf:service('printPdf'),
    cancel:service('cancel'),consultCancellation:service('consultCancellation'),
    prepareCancellation:service('prepareCancellation'),
    saveNationalDps:args=>national.saveNationalDps(args),
    prepareAutomaticNationalDps:args=>national.prepareAutomaticNationalDps(args),
    nationalDpsStatus:args=>national.nationalDpsStatus(args)
  });
}

let tenantFactory;
try{
 await registryPool.query('SELECT 1');
 const registry=createPostgresTenantRegistry(createCommonDataAdapter({
   engine:'postgres',pool:registryPool
 }));
 const explicitlyNew=process.env.OFICINA_REGISTRY_NEW_INSTALL==='true';
 const managedLocal=process.env.OFICINA_POSTGRES_MANAGED_LOCAL==='true';
 let fresh=explicitlyNew;
 if(managedLocal){
   // A missing registry table in an existing local cluster is DATA LOSS,
   // not a new installation. Preserve the first-run form across restarts.
   const marker=await registryPool.query("SELECT to_regclass('public.tenant_registry_bootstrap') AS name");
   if(!marker.rows[0]?.name&&!explicitlyNew)
     throw Error('Registry PostgreSQL desapareceu; restauração auditada obrigatória');
   if(marker.rows[0]?.name){
     const rows=await registryPool.query('SELECT pending FROM tenant_registry_bootstrap WHERE id=1');
     if(!rows.rows.length)throw Error('Marcador de bootstrap desapareceu; restauração obrigatória');
     fresh=Number(rows.rows[0].pending)===1;
   }
 }
 await registry.initialize({allowBootstrap:fresh});
 const token=randomBytes(48).toString('base64url');
 tenantFactory=createPostgresTenantRuntimeFactory({
   Pool,connectionString:operationsUrl,registry,serviceToken:token,
   allowProvision:process.env.OFICINA_POSTGRES_PROVISION_NEW_UNITS==='true',
   schemaPrefix:process.env.OFICINA_POSTGRES_SCHEMA_PREFIX||'oficina',
   localStorageRoot:process.env.OFICINA_POSTGRES_STORAGE_ROOT||'./storage/postgres',
   paymentOptionsForUnit:unit=>({...resolveTenantPaymentOptions(unit,tenantPaymentConfigs),
      reminderSender:reminderSenderForUnit(unit)}),
   fiscalProviderForUnit
 });
 const gateway=createPostgresUnifiedGateway({
   registry,tenantHandlerForUnit:tenantFactory.handlerForUnit,
   serviceToken:token,allowAdminBootstrap:fresh,publicOrigin
 });
 const server=createServer(async(req,res)=>{
  const requestedHost=String(req.headers.host||'');
  let url;
  try{url=workshopRequestUrl(req.url||'/',requestedHost,publicOrigin);}catch{
   return respond(res,400,{},'Host ou URL inválido');
  }
  if(!url.pathname.startsWith('/api/')){
   if(req.method!=='GET'&&req.method!=='HEAD')
    return respond(res,405,{},'Method not allowed');
   return staticAsset(url,res);
  }
  const max=requestPayloadLimit(req.method,url.pathname);
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
