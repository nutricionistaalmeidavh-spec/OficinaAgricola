import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, join, dirname, sep } from 'node:path';
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { openDatabase, migrate, nowIso, transaction } from '../db.js';
import { migrateAssistencia } from '../assistencia-schema.js';
import { createAssistenciaServer } from '../server-assistencia.js';
import { initializeAdmin, isSetupRequired } from '../setup.js';
import { authTokenFrom, assertSameOrigin, prefersCookie, issueBrowserCookie, clearBrowserCookie, hardenHttpResponse } from './session-http.js';
import { assertSecureNetwork } from './network.js';
import { loginHttp, validateSession, logout, hashPassword } from '../auth.js';
import { createApprovalLink, createMaintenanceCrmTasks } from '../services/market-parity.js';
import { financeSummary } from '../services/finance.js';
import { sharePartCatalog, shareCustomer } from './tenant-catalog-sharing.js';
import { transferTenantStock, retryTenantStockTransfer, listTenantStockTransfers } from './tenant-stock-transfer.js';
import { resolveTenantFiscalProvider, validateTenantFiscalConfigs } from './tenant-fiscal.js';
import { transferTenantWorkOrder, retryTenantWorkOrderTransfer, getTenantTransferDossier, listTenantOrderTransfers } from './tenant-os-transfer.js';
import { seedDefaultChecklists, recoverOrphanAttachments } from '../services/operations.js';
import { readRemoteAttachment } from './remote-attachments.js';
import { createEventRuntime } from './event-runtime.js';
import { dispatchOutbox } from './outbox.js';
import { auditInvariants } from '../services/reconciliation.js';
import {
  migrateTenantRegistry, registerInitialAdmin, listUserUnits, requireUnitMembership,
  requireCompanyAdmin, requireCompanyReportingAdmin, createTenantCompany, createTenantUnit, grantUnitMembership,
  changeUnitMembership, listUnitMembers, markLegacyRegistryLink, listTenantAudit
} from './tenant-registry.js';

const json=(res,status,data)=>{if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const httpError=(message,status=400)=>Object.assign(new Error(message),{status});
const tokenDigest=value=>createHash('sha256').update(value).digest('hex');
async function readJson(req){
  let bytes=0;const buffers=[];
  for await(const part of req){bytes+=part.length;if(bytes>1048576)throw httpError('Requisição muito grande',413);buffers.push(part);}
  if(!bytes)return {};
  try{return JSON.parse(Buffer.concat(buffers).toString('utf8'));}
  catch{throw httpError('JSON inválido',400);}
}
const positive=value=>{const id=Number(value);if(!Number.isSafeInteger(id)||id<1)throw httpError('Identificador inválido',400);return id;};

/**
 * Multiempresa opt-in gateway. Existing business queries cannot omit tenant
 * predicates because every operational unit owns its own physical database
 * and uploads directory. The registry stores only identities and memberships.
 *
 * Global sessions are validated before each dispatch. Local shadow sessions
 * are implementation details and never authorize access without the registry.
 */
export function createMultiTenantServer({
  registryDb = openDatabase('./data/oficina-registry.sqlite'),
  legacyDb = openDatabase(),
  legacyDatabasePath = process.env.DATABASE_PATH || './data/artisys-oficina.sqlite',
  legacyStorageDir = process.env.STORAGE_DIR || './storage/uploads',
  tenantsRoot = './data/oficina-tenants',
  tls = null,
  tenantFiscalConfigs = {},
  objectStoreForUnit = null,
  unitServerFactory = createAssistenciaServer
} = {}) {
  migrate(legacyDb);
  migrateAssistencia(legacyDb);
  const legacyOtherUnitOrders=legacyDb.prepare('SELECT COUNT(*) n FROM work_orders WHERE unit_id IS NOT NULL AND unit_id<>1').get().n;
  if(legacyOtherUnitOrders)
    throw httpError('Banco legado já contém OS de várias unidades. Migração segura das OS e seus vínculos é obrigatória antes de ativar o modo multiempresa.',409);
  migrateTenantRegistry(registryDb,legacyDb);
  validateTenantFiscalConfigs(tenantFiscalConfigs);
  const root=resolve(tenantsRoot);
  const cache=new Map();
  function unitRuntime(unitId) {
    const id=positive(unitId);
    const found=cache.get(id);if(found)return found;
    const unit=registryDb.prepare("SELECT u.id,u.company_id AS companyId,u.name,c.name AS companyName FROM tenant_units u JOIN tenant_companies c ON c.id=u.company_id WHERE u.id=? AND u.active=1 AND c.active=1").get(id);
    if(!unit)throw httpError('Unidade indisponível',404);
    const isLegacy=id===1&&unit.companyId===1;
    const dir=join(root,'company-'+unit.companyId,'unit-'+id);
    if(!isLegacy)mkdirSync(dir,{recursive:true});
    const db=isLegacy?legacyDb:openDatabase(join(dir,'oficina.sqlite'));
    if(!isLegacy){migrate(db);migrateAssistencia(db);}
    seedDefaultChecklists(db);
    const storageDir=isLegacy?resolve(legacyStorageDir):join(dir,'uploads');
    mkdirSync(storageDir,{recursive:true});
    recoverOrphanAttachments(db,storageDir);
    const auditPath=isLegacy?(process.env.EVENT_LOG_PATH || join(dirname(resolve(legacyDatabasePath)),'oficina-events.jsonl')):join(dir,'events.jsonl');
    const eventRuntime=createEventRuntime({auditPath});
    const configPresent=Object.hasOwn(tenantFiscalConfigs,String(unit.companyId));
    const scopedFiscalProvider=configPresent
      ?resolveTenantFiscalProvider({companyId:unit.companyId,configs:tenantFiscalConfigs}):null;
    // Legacy can still use the existing single-company local provider,
    // but never leak process-wide credentials into an unrelated unit.
    const fiscalProviderOverride=isLegacy&&!configPresent?undefined:scopedFiscalProvider;
    // A unit-specific S3 namespace is derived from trusted registry IDs, never
    // from request headers or client-controlled JSON.
    const objectStore=objectStoreForUnit?objectStoreForUnit(unit):null;
    const srv=unitServerFactory({db,storageDir,eventRuntime,tls:null,fiscalProviderOverride,objectStore});
    const runtime={db,srv,unit,storageDir,objectStore,eventRuntime,owned:!isLegacy,
      fiscalConfigured:isLegacy||Boolean(scopedFiscalProvider)};
    cache.set(id,runtime);
    return runtime;
  }
  function syncShadowSession(globalUser,token,unit) {
    const runtime=unitRuntime(unit.id),db=runtime.db;
    let local=db.prepare('SELECT id,role,active FROM users WHERE username=? COLLATE NOCASE').get(globalUser.username);
    if(!local) {
      // The tenant DB must not contain a reusable copy of the global password.
      const randomPassword=randomBytes(48).toString('base64url');
      const created=nowIso();
      const id=db.prepare('INSERT INTO users(username,password_hash,name,role,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)')
        .run(globalUser.username,hashPassword(randomPassword),globalUser.name,unit.role,created,created).lastInsertRowid;
      local={id};
    } else if(local.role!==unit.role || !local.active) {
      db.prepare('UPDATE users SET role=?,active=1,name=?,updated_at=? WHERE id=?').run(unit.role,globalUser.name,nowIso(),local.id);
    }
    const digest=tokenDigest(token);
    const session=registryDb.prepare('SELECT created_at,expires_at FROM sessions WHERE token_hash=? AND user_id=?').get(digest,globalUser.id);
    if(!session)throw httpError('Sessão inválida',401);
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET user_id=excluded.user_id,expires_at=excluded.expires_at')
      .run(digest,local.id,session.created_at,session.expires_at);
    return runtime;
  }
  function selectUnit(req,user) {
    const memberships=listUserUnits(registryDb,user.id);
    if(!memberships.length)throw httpError('Permissão: usuário sem vínculo com oficina',403);
    const requested=req.headers['x-oficina-unit'];
    if(Array.isArray(requested))throw httpError('Unidade ambígua',400);
    if(requested===undefined || requested===''){
      if(memberships.length!==1)throw httpError('Selecione uma oficina para continuar',409);
      return requireUnitMembership(registryDb,user.id,memberships[0].id);
    }
    return requireUnitMembership(registryDb,user.id,requested);
  }
  async function controlApi(req,res,url){
    const method=req.method||'GET',path=url.pathname,token=authTokenFrom(req);
    if(path==='/api/health'&&method==='GET')return json(res,200,{ok:true,mode:'multiempresa'});
    if(path==='/api/setup/status'&&method==='GET')return json(res,200,{required:isSetupRequired(registryDb)});
    if(path==='/api/setup/initialize'&&method==='POST'){
      const body=await readJson(req);
      const user=transaction(registryDb,()=>{
        const created=initializeAdmin(registryDb,req,body);
        registerInitialAdmin(registryDb,created.id);
        markLegacyRegistryLink(legacyDb);
        return created;
      });
      return json(res,200,user);
    }
    if(path==='/api/auth/login'&&method==='POST'){
      const body=await readJson(req);
      const identity=await loginHttp(registryDb,body.username,body.password,{remoteAddress:req.socket.remoteAddress});
      if(!listUserUnits(registryDb,identity.user.id).length)throw httpError('Permissão: usuário sem vínculo',403);
      if(prefersCookie(req)){
        issueBrowserCookie(res,req,identity.token);
        return json(res,200,{user:identity.user,expiresAt:identity.expiresAt});
      }
      return json(res,200,identity);
    }
    const user=validateSession(registryDb,token);
    if(path==='/api/auth/logout'&&method==='POST'){
      logout(registryDb,token);
      for(const runtime of cache.values())runtime.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenDigest(token));
      clearBrowserCookie(res,req);
      return json(res,200,{ok:true});
    }
    if(path==='/api/auth/me'&&method==='GET'){
      const units=listUserUnits(registryDb,user.id);
      if(!units.length)throw httpError('Permissão: usuário sem vínculo',403);
      const selected=req.headers['x-oficina-unit'];
      const unit=selected?requireUnitMembership(registryDb,user.id,selected):units[0];
      return json(res,200,{...user,role:unit.role});
    }
    if(path==='/api/tenancy/context'&&method==='GET'){
      const units=listUserUnits(registryDb,user.id);
      return json(res,200,{units,platformAdmin:Boolean(registryDb.prepare('SELECT 1 FROM tenant_platform_admins WHERE user_id=?').get(user.id))});
    }
    if(path==='/api/tenancy/companies'&&method==='POST')
      return json(res,201,createTenantCompany(registryDb,user.id,await readJson(req)));
    if(path==='/api/tenancy/units'&&method==='POST')
      return json(res,201,createTenantUnit(registryDb,user.id,await readJson(req)));
    if(path==='/api/tenancy/memberships'&&method==='POST')
      return json(res,201,grantUnitMembership(registryDb,user.id,await readJson(req)));
    if(path==='/api/tenancy/memberships'&&method==='PATCH')
      return json(res,200,changeUnitMembership(registryDb,user.id,await readJson(req)));
    if(path==='/api/tenancy/memberships'&&method==='GET')
      return json(res,200,listUnitMembers(registryDb,user.id,positive(url.searchParams.get('unitId'))));
    if(path==='/api/tenancy/shareable-customers'&&method==='GET'){
      const source=requireUnitMembership(registryDb,user.id,positive(url.searchParams.get('unitId')));
      if(source.role!=='ADMIN')throw httpError('Administração da unidade é necessária',403);
      const search=String(url.searchParams.get('search')||'').trim();
      if(search.length>80)throw httpError('Busca excede 80 caracteres',400);
      const term='%'+search+'%';
      const rows=unitRuntime(source.id).db.prepare(
        'SELECT id,name FROM customers WHERE active=1 AND name LIKE ? ORDER BY id DESC LIMIT 100'
      ).all(term);
      return json(res,200,{customers:rows,limit:100});
    }
    if(path==='/api/tenancy/share-customer'&&method==='POST'){
      const body=await readJson(req);
      return json(res,200,shareCustomer({...body,registryDb,unitRuntime,actorUserId:user.id}));
    }
    if(path==='/api/tenancy/shareable-parts'&&method==='GET'){
      const source=requireUnitMembership(registryDb,user.id,positive(url.searchParams.get('unitId')));
      if(source.role!=='ADMIN')throw httpError('Administração da unidade é necessária',403);
      const search=String(url.searchParams.get('search')||'').trim();
      if(search.length>80)throw httpError('Busca excede 80 caracteres',400);
      const term='%'+search+'%';
      const rows=unitRuntime(source.id).db.prepare(
        'SELECT id,sku,description,unit,quantity FROM parts WHERE active=1 AND (sku LIKE ? OR description LIKE ?) ORDER BY id DESC LIMIT 100'
      ).all(term,term);
      return json(res,200,{parts:rows,limit:100});
    }
    if(path==='/api/tenancy/share-part'&&method==='POST'){
      const body=await readJson(req);
      return json(res,200,sharePartCatalog({...body,registryDb,unitRuntime,actorUserId:user.id}));
    }

    if(path==='/api/tenancy/os-transfers'&&method==='GET'){
      const transfers=listTenantOrderTransfers({
        registryDb,actorUserId:user.id,companyId:positive(url.searchParams.get('companyId'))
      });
      return json(res,200,{transfers});
    }
    const transferAttachment=path.match(/^\/api\/tenancy\/os-transfer\/(\d+)\/attachments\/(\d+)\/file$/);
    if(transferAttachment&&method==='GET'){
      const dossier=getTenantTransferDossier({
        registryDb,unitRuntime,actorUserId:user.id,transferId:positive(transferAttachment[1])
      });
      const attachment=dossier.attachments.find(a=>a.id===positive(transferAttachment[2]));
      if(!attachment)throw httpError('Anexo não pertence à OS de origem',404);
      const source=unitRuntime(dossier.originUnitId);
      const record=source.db.prepare('SELECT * FROM attachments WHERE id=? AND work_order_id=?')
        .get(attachment.id,dossier.sourceWorkOrderId);
      if(!record)throw httpError('Anexo de origem não encontrado',404);
      let bytes;
      if(record.relative_path.startsWith('s3:')){
        if(!source.objectStore)throw httpError('Storage remoto de origem não configurado',503);
        bytes=await readRemoteAttachment(record,source.objectStore);
      }else{
        const root=realpathSync(source.storageDir);
        const file=realpathSync(resolve(root,record.relative_path));
        if(!file.startsWith(root+sep))throw httpError('Caminho de anexo inválido',403);
        const info=statSync(file);
        if(!info.isFile()||info.size>5*1024*1024||info.size!==record.size_bytes)
          throw httpError('Arquivo de evidência inválido',409);
        bytes=readFileSync(file);
      }
      const safeName=record.original_name.replace(/[\r\n"\\]/g,'_').replace(/[^\w .()-]/g,'_').slice(0,100)||'evidencia';
      res.writeHead(200,{
        'Content-Type':record.mime_type,
        'Content-Length':String(bytes.length),
        'Content-Disposition':'attachment; filename="'+safeName+'"',
        'Cache-Control':'private, no-store',
        'X-Content-Type-Options':'nosniff'
      });
      return res.end(bytes);
    }
    const transferDossier=path.match(/^\/api\/tenancy\/os-transfer\/(\d+)\/dossier$/);
    if(transferDossier&&method==='GET'){
      return json(res,200,getTenantTransferDossier({
        registryDb,unitRuntime,actorUserId:user.id,transferId:positive(transferDossier[1])
      }));
    }
    if(path==='/api/tenancy/transferable-orders'&&method==='GET'){
      const unit=requireUnitMembership(registryDb,user.id,positive(url.searchParams.get('unitId')));
      if(unit.role!=='ADMIN')throw httpError('Administração da unidade é necessária',403);
      const records=unitRuntime(unit.id).db.prepare(`SELECT id,os_number,problem_reported,status
        FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','TRANSFERIDA')
        ORDER BY id DESC LIMIT 100`).all();
      return json(res,200,{orders:records,limit:100});
    }
    if(path==='/api/tenancy/os-transfer'&&method==='POST'){
      const body=await readJson(req);
      return json(res,200,transferTenantWorkOrder({...body,registryDb,unitRuntime,actorUserId:user.id}));
    }
    if(path==='/api/tenancy/os-transfer/retry'&&method==='POST'){
      const body=await readJson(req);
      return json(res,200,retryTenantWorkOrderTransfer({...body,registryDb,unitRuntime,actorUserId:user.id}));
    }
    if(path==='/api/tenancy/stock-transfer'&&method==='POST'){
      const body=await readJson(req);
      const result=transferTenantStock({...body,registryDb,unitRuntime,actorUserId:user.id});
      return json(res,result.status==='PENDING'?202:200,result);
    }
    if(path==='/api/tenancy/stock-transfer/retry'&&method==='POST'){
      const body=await readJson(req);
      const result=retryTenantStockTransfer({...body,registryDb,unitRuntime,actorUserId:user.id});
      return json(res,result.status==='PENDING'?202:200,result);
    }
    if(path==='/api/tenancy/stock-transfers'&&method==='GET'){
      return json(res,200,{transfers:listTenantStockTransfers({
        registryDb,actorUserId:user.id,companyId:positive(url.searchParams.get('companyId'))
      })});
    }
    if(path==='/api/tenancy/audit'&&method==='GET')
      return json(res,200,listTenantAudit(registryDb,user.id,positive(url.searchParams.get('companyId'))));
    if(path==='/api/tenancy/company-summary'&&method==='GET'){
      const companyId=positive(url.searchParams.get('companyId'));
      requireCompanyReportingAdmin(registryDb,user.id,companyId);
      const parseDate=(key,fallback)=>{
        const value=url.searchParams.get(key);
        if(value===null)return fallback;
        const d=new Date(value);
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(d.getTime())||!d.toISOString().startsWith(value.slice(0,10)))
          throw httpError('Data '+key+' inválida: use ISO 8601 UTC',400);
        return d.toISOString();
      };
      const from=parseDate('from','1970-01-01T00:00:00.000Z');
      const to=parseDate('to','2999-12-31T23:59:59.999Z');
      if(from>to)throw httpError('Período inválido: from após to',400);
      const allowedUnits=registryDb.prepare('SELECT id,code,name FROM tenant_units WHERE company_id=? AND active=1 ORDER BY id').all(companyId);
      const perUnit=allowedUnits.map(u=>{
        const {db}=unitRuntime(u.id);
        const customerCount=db.prepare('SELECT COUNT(*) n FROM customers WHERE active=1').get().n;
        const workOrderCount=db.prepare('SELECT COUNT(*) n FROM work_orders').get().n;
        const openOrders=db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','TRANSFERIDA')").get().n;
        const partsCount=db.prepare('SELECT COUNT(*) n FROM parts WHERE active=1').get().n;
        // Reuse canonical finance rules per physical unit: paid/returned events
        // and paid expenses only, with no direct cross-company SQL joins.
        const finance=financeSummary(db,{from,to});
        return {id:u.id,code:u.code,name:u.name,customers:customerCount,workOrders:workOrderCount,openOrders,parts:partsCount,finance};
      });
      const money=['invoicedCents','receivedCents','pendingCents','expensesCents','resultCents'];
      const totals=perUnit.reduce((x,u)=>{
        x.customers+=u.customers;x.workOrders+=u.workOrders;x.openOrders+=u.openOrders;x.parts+=u.parts;
        for(const key of money)x.finance[key]+=u.finance[key];
        return x;
      },{customers:0,workOrders:0,openOrders:0,parts:0,finance:Object.fromEntries(money.map(key=>[key,0]))});
      return json(res,200,{companyId,period:{from,to},units:perUnit,totals,scope:'company-only-canonical-finance'});
    }
    const unit=selectUnit(req,user);
    if(path==='/api/users'&&method==='GET')return json(res,200,listUnitMembers(registryDb,user.id,unit.id));
    if(path==='/api/users'&&method==='POST')
      return json(res,201,grantUnitMembership(registryDb,user.id,{...await readJson(req),unitId:unit.id}));
    const userMatch=path.match(/^\/api\/users\/(\d+)$/);
    if(userMatch&&method==='PATCH')
      return json(res,200,changeUnitMembership(registryDb,user.id,{...await readJson(req),unitId:unit.id,userId:positive(userMatch[1])}));
    if(path==='/api/units'&&method==='GET'){
      const rows=listUserUnits(registryDb,user.id).filter(x=>x.companyId===unit.companyId);
      return json(res,200,rows.map(x=>({id:x.id,code:x.code,name:x.name,active:1})));
    }
    if(path==='/api/units'&&method==='POST'){
      const body=await readJson(req);
      return json(res,201,createTenantUnit(registryDb,user.id,{...body,companyId:unit.companyId}));
    }
    if(path==='/api/units/assign'&&method==='POST')
      throw httpError('OS pertence à unidade de origem. Transferência entre unidades exige uma operação auditada.',409);
    // This endpoint intentionally returns the current unit's report, not an
    // unauthorized cross-company aggregation.
    const runtime=syncShadowSession(user,token,unit);
    // Reject transmission without an explicitly scoped provider; the legacy
    // unit is the only unit permitted to inherit the historical process env.
    if(/^\/api\/fiscal\/\d+\/(submit|reconcile)$/.test(path)
       &&!unitRuntime(unit.id).fiscalConfigured)
      throw httpError('Emissão fiscal da empresa não configurada: configure um emissor isolado',409);
    if(method==='POST'&&/^\/api\/work-orders\/\d+\/quote\/approval-link$/.test(path)){
      if(!['ADMIN','ATENDIMENTO'].includes(unit.role))throw httpError('Permissão insuficiente',403);
      const id=positive(path.split('/')[3]);
      const result=createApprovalLink(runtime.db,id,await readJson(req));
      return json(res,200,{...result,path:result.path+'&unit='+unit.id});
    }
    runtime.srv.emit('request',req,res);
  }
  const handler=async(req,res)=>{
    const url=new URL(req.url||'/','http://localhost');
    hardenHttpResponse(res,req);
    try{
      assertSecureNetwork(req); assertSameOrigin(req);
      // Public approval links are explicitly bound to a single registered unit.
      if(url.pathname.startsWith('/api/public/approval/')){
        const unitId=positive(url.searchParams.get('unit'));
        const token=url.pathname.split('/').at(-1);
        if(!/^[a-f0-9]{64}$/.test(token))throw httpError('Link inválido',404);
        const runtime=unitRuntime(unitId);
        if(!runtime.db.prepare('SELECT 1 FROM quote_approval_links WHERE token_hash=?').get(tokenDigest(token)))
          throw httpError('Link inválido',404);
        return runtime.srv.emit('request',req,res);
      }
      if(url.pathname.startsWith('/api/'))
        return await controlApi(req,res,url);
      // Only publicly served static files reach this branch.
      return unitRuntime(1).srv.emit('request',req,res);
    }catch(error){
      const status=error.status||(/Sessão|Credenciais/.test(error.message)?401:/Permissão/.test(error.message)?403:/UNIQUE constraint/.test(error.message)?409:400);
      console.error('[tenancy]',req.method,url.pathname.startsWith('/api/public/approval/')?'/api/public/approval/[redacted]':url.pathname,error.message);
      json(res,status,{error:error.message||'Erro inesperado'});
    }
  };
  const server=tls?createHttpsServer(tls,handler):createHttpServer(handler);
  const flush=()=>{for(const runtime of cache.values())
    void dispatchOutbox(runtime.db,runtime.eventRuntime).catch(error=>console.error('[tenancy-outbox]',error.message));};
  const outboxTimer=setInterval(flush,15000);outboxTimer.unref?.();
  const maintenance=()=>{
    for(const {id} of registryDb.prepare('SELECT id FROM tenant_units WHERE active=1').all()){
      try{
        const runtime=unitRuntime(id);
        createMaintenanceCrmTasks(runtime.db,{daysAhead:7});
        const audit=auditInvariants(runtime.db);
        if(!audit.ok)console.warn('[tenancy-reconciliation]',id,JSON.stringify(audit.errors));
      }catch(error){console.error('[tenancy-maintenance]',id,error.message);}
    }
    flush();
  };
  const maintenanceTimer=setInterval(maintenance,6*60*60*1000);maintenanceTimer.unref?.();
  const initial=setImmediate(maintenance);
  server.on('close',()=>{
    clearInterval(outboxTimer);clearInterval(maintenanceTimer);clearImmediate(initial);
    for(const runtime of cache.values()){
      runtime.eventRuntime.close();
      if(runtime.owned)runtime.db.close();
    }
  });
  return server;
}
