import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrate, nowIso, transaction } from './db.js';
import {enqueueHttpEvent,dispatchOutbox} from './platform/outbox.js';
import {runIdempotent} from './platform/idempotency.js';
import {auditInvariants} from './services/reconciliation.js';
import {duplicateWorkOrderWithQuote} from './services/work-order-duplication.js';
import {getCompanySettings,updateCompanySettings,listStaffUsers,createStaffUser,updateStaffUser} from './services/admin.js';
import { login, logout, validateSession } from './auth.js';
import { createCustomer, listCustomers, updateCustomer, getCustomer, createMachine, listMachines, updateMachine, getMachine, createTechnician, listTechnicians, updateTechnician } from './services/catalog.js';
import { createWorkOrder, listWorkOrders, getWorkOrder, updateWorkOrder, transitionWorkOrder, getWorkOrderHistory, machineHistory } from './services/work-orders.js';
import { saveQuote, getQuote, submitQuote, approveQuote, rejectQuote } from './services/quotes.js';
import { renderDocument, renderPdfDocument } from './documents.js';
import { createPart, listParts, updatePart, addInventoryMovement, consumePart, reverseWorkOrderPart, listWorkOrderParts, lowStockParts } from './services/inventory.js';
import { createScheduleEvent, listSchedule, updateScheduleEvent, createChecklistTemplate, getChecklistTemplate, listChecklistTemplates, createWorkOrderChecklist, listWorkOrderChecklists, saveAttachment, listAttachments } from './services/operations.js';
import { addReceipt, reverseReceipt, listReceipts, getPaymentSummary, createExpense, updateExpense, listExpenses, financeSummary } from './services/finance.js';
import { dashboardData } from './services/dashboard.js';
import { seed } from './seed.js';
import {listServiceRecords,createServiceRecord} from './services/vehicle-maintenance.js';
import {isSetupRequired,initializeAdmin} from './setup.js';

const __dirname=fileURLToPath(new URL('.',import.meta.url));
const publicDir=resolve(__dirname,'../public');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
const ROLE_ALL=['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO'];
const ROLE_OFFICE=['ADMIN','ATENDIMENTO'];
const ROLE_TECH=['ADMIN','ATENDIMENTO','TECNICO'];
const ROLE_FIN=['ADMIN','FINANCEIRO'];

function compile(pattern){
  const names=[]; const parts=pattern.split('/').filter(Boolean).map(p=>{if(p.startsWith(':')){names.push(p.slice(1));return '([^/]+)'}return p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')});
  return {regex:new RegExp('^/'+parts.join('/')+'/?$'),names};
}
class Router{
  constructor(){this.routes=[]}
  add(method,pattern,roles,handler,{publicRoute=false}={}){const c=compile(pattern);this.routes.push({method,pattern,roles,handler,publicRoute,...c})}
  match(method,path){for(const r of this.routes){if(r.method!==method)continue;const m=path.match(r.regex);if(m){const params={};r.names.forEach((n,i)=>params[n]=decodeURIComponent(m[i+1]));return {...r,params}}}return null}
}

function json(res,status,data,extra={}){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(body)}
function html(res,status,body){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(body)}
async function readJson(req,max=8*1024*1024){
  let total=0;const chunks=[];for await(const chunk of req){total+=chunk.length;if(total>max)throw new Error('Corpo da requisição excede o limite');chunks.push(chunk)}
  if(!chunks.length)return {}; const raw=Buffer.concat(chunks).toString('utf8');try{return JSON.parse(raw)}catch{throw new Error('JSON inválido')}
}
function tokenFrom(req){const auth=req.headers.authorization||'';if(auth.startsWith('Bearer '))return auth.slice(7).trim();return null}
function statusFor(error){const m=String(error?.message||'');if(/Credenciais|Sessão/.test(m))return 401;if(/Permissão/.test(m))return 403;if(/não encontrad|não encontrado|não encontrada/i.test(m))return 404;if(/Transição inválida|não pode|já |insuficiente|saldo pendente|não aguarda|UNIQUE constraint|pertence/i.test(m))return 409;return 400}
function roleGuard(user,roles){if(!roles||roles.length===0)return;if(!user||!roles.includes(user.role))throw new Error('Permissão insuficiente')}
const int=(v)=>{const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error('Identificador inválido');return n};

function createRouter({db,storageDir}){
  const r=new Router(); const add=(m,p,roles,h,o)=>r.add(m,p,roles,h,o);
  add('GET','/api/health',null,()=>({ok:true}),{publicRoute:true});
  add('GET','/api/setup/status',null,()=>({required:isSetupRequired(db)}),{publicRoute:true});
  add('POST','/api/setup/initialize',null,({req,body})=>initializeAdmin(db,req,body),{publicRoute:true});
  add('POST','/api/auth/login',null,({body})=>login(db,body.username,body.password),{publicRoute:true});
  add('POST','/api/auth/logout',ROLE_ALL,({token})=>{logout(db,token);return {ok:true}});
  add('GET','/api/auth/me',ROLE_ALL,({user})=>user);

  add('GET','/api/company',ROLE_ALL,()=>getCompanySettings(db));
  add('PATCH','/api/company',['ADMIN'],({body})=>updateCompanySettings(db,body));
  add('GET','/api/users',['ADMIN'],()=>listStaffUsers(db));
  add('POST','/api/users',['ADMIN'],({body})=>createStaffUser(db,body));
  add('PATCH','/api/users/:id',['ADMIN'],({params,body})=>updateStaffUser(db,int(params.id),body));

  add('GET','/api/customers',ROLE_ALL,({url})=>listCustomers(db,{includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||''}));
  add('POST','/api/customers',ROLE_OFFICE,({body})=>createCustomer(db,body));
  add('GET','/api/customers/:id',ROLE_ALL,({params})=>getCustomer(db,int(params.id)));
  add('PATCH','/api/customers/:id',ROLE_OFFICE,({params,body})=>updateCustomer(db,int(params.id),body));
  add('GET','/api/machines',ROLE_ALL,({url})=>listMachines(db,{customerId:url.searchParams.get('customerId')?int(url.searchParams.get('customerId')):undefined,includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||''}));
  add('POST','/api/machines',ROLE_OFFICE,({body})=>createMachine(db,body));
  add('GET','/api/machines/:id',ROLE_ALL,({params})=>getMachine(db,int(params.id)));
  add('PATCH','/api/machines/:id',ROLE_OFFICE,({params,body})=>updateMachine(db,int(params.id),body));
  add('GET','/api/machines/:id/history',ROLE_ALL,({params})=>machineHistory(db,int(params.id)));
  add('GET','/api/machines/:id/maintenance',ROLE_ALL,({params})=>listServiceRecords(db,int(params.id)));
  add('POST','/api/machines/:id/maintenance',ROLE_OFFICE,({params,body})=>createServiceRecord(db,int(params.id),body));
  add('GET','/api/technicians',ROLE_ALL,()=>listTechnicians(db,{includeInactive:true}));
  add('POST','/api/technicians',['ADMIN'],({body})=>createTechnician(db,body));
  add('PATCH','/api/technicians/:id',['ADMIN'],({params,body})=>updateTechnician(db,int(params.id),body));

  add('GET','/api/work-orders',ROLE_ALL,({url})=>listWorkOrders(db,{status:url.searchParams.get('status')||undefined,search:url.searchParams.get('search')||''}));
  add('POST','/api/work-orders',ROLE_OFFICE,({body,user})=>createWorkOrder(db,{...body,createdBy:user.id}));
  add('POST','/api/work-orders/:id/duplicate',ROLE_OFFICE,({params,body,user})=>
    duplicateWorkOrderWithQuote(db,int(params.id),body,{createdBy:user.id}));
  add('GET','/api/work-orders/:id',ROLE_ALL,({params})=>getWorkOrder(db,int(params.id)));
  add('PATCH','/api/work-orders/:id',ROLE_TECH,({params,body,user})=>updateWorkOrder(db,int(params.id),body,{changedBy:user.id}));
  add('POST','/api/work-orders/:id/status',ROLE_TECH,({params,body,user})=>transitionWorkOrder(db,int(params.id),body.status,{reason:body.reason,changedBy:user.id,expectedVersion:body.expectedVersion??null}));
  add('GET','/api/work-orders/:id/history',ROLE_ALL,({params})=>getWorkOrderHistory(db,int(params.id)));

  add('GET','/api/work-orders/:id/quote',ROLE_ALL,({params})=>getQuote(db,int(params.id)));
  add('PUT','/api/work-orders/:id/quote',ROLE_OFFICE,({params,body})=>saveQuote(db,int(params.id),body));
  add('POST','/api/work-orders/:id/quote/submit',ROLE_OFFICE,({params})=>submitQuote(db,int(params.id)));
  add('POST','/api/work-orders/:id/quote/approve',ROLE_OFFICE,({params})=>approveQuote(db,int(params.id)));
  add('POST','/api/work-orders/:id/quote/reject',ROLE_OFFICE,({params,body})=>rejectQuote(db,int(params.id),body.reason));
  add('GET','/api/work-orders/:id/documents/:kind/pdf',ROLE_ALL,({params})=>{const id=int(params.id),os=getWorkOrder(db,id);return {__binary:renderPdfDocument(db,id,params.kind),mimeType:'application/pdf',filename:`OS-${os.os_number}.pdf`}});
  add('GET','/api/work-orders/:id/documents/:kind',ROLE_ALL,({params})=>({__html:renderDocument(db,int(params.id),params.kind)}));

  add('GET','/api/parts',ROLE_ALL,({url})=>listParts(db,{includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||''}));
  add('POST','/api/parts',ROLE_OFFICE,({body})=>createPart(db,body));
  add('PATCH','/api/parts/:id',ROLE_OFFICE,({params,body})=>updatePart(db,int(params.id),body));
  add('POST','/api/inventory/movements',ROLE_OFFICE,({body,user})=>addInventoryMovement(db,int(body.partId),{...body,createdBy:user.id,userRole:user.role}));
  add('GET','/api/inventory/low-stock',ROLE_ALL,()=>lowStockParts(db));
  add('GET','/api/work-orders/:id/parts',ROLE_ALL,({params})=>listWorkOrderParts(db,int(params.id)));
  add('POST','/api/work-orders/:id/parts',ROLE_TECH,({params,body,user})=>consumePart(db,int(params.id),int(body.partId),{...body,createdBy:user.id,userRole:user.role}));
  add('POST','/api/work-orders/:id/parts/:itemId/reverse',ROLE_TECH,({params,body,user})=>reverseWorkOrderPart(db,int(params.itemId),{note:body.note,createdBy:user.id,workOrderId:int(params.id)}));

  add('GET','/api/schedule',ROLE_ALL,({url})=>listSchedule(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));
  add('POST','/api/schedule',ROLE_TECH,({body})=>createScheduleEvent(db,body));
  add('PATCH','/api/schedule/:id',ROLE_TECH,({params,body})=>updateScheduleEvent(db,int(params.id),body));
  add('GET','/api/checklist-templates',ROLE_ALL,()=>listChecklistTemplates(db));
  add('GET','/api/checklist-templates/:id',ROLE_ALL,({params})=>getChecklistTemplate(db,int(params.id)));
  add('POST','/api/checklist-templates',['ADMIN'],({body})=>createChecklistTemplate(db,body));
  add('GET','/api/work-orders/:id/checklists',ROLE_ALL,({params})=>listWorkOrderChecklists(db,int(params.id)));
  add('POST','/api/work-orders/:id/checklists',ROLE_TECH,({params,body})=>createWorkOrderChecklist(db,int(params.id),int(body.templateId),body.responses||[]));
  add('GET','/api/work-orders/:id/attachments',ROLE_ALL,({params})=>listAttachments(db,int(params.id)));
  add('POST','/api/work-orders/:id/attachments',ROLE_TECH,({params,body})=>saveAttachment(db,int(params.id),{...body,storageDir}));
  add('GET','/api/attachments/:id/file',ROLE_ALL,({params})=>{const a=db.prepare('SELECT * FROM attachments WHERE id=?').get(int(params.id));if(!a)throw new Error('Anexo não encontrado');const root=resolve(storageDir),file=resolve(root,a.relative_path);if(file!==root&&!file.startsWith(root+sep))throw new Error('Caminho de anexo inválido');if(!existsSync(file))throw new Error('Arquivo de anexo não encontrado');return {__binary:readFileSync(file),mimeType:a.mime_type,filename:a.original_name}});

  add('GET','/api/work-orders/:id/payment',ROLE_ALL,({params})=>getPaymentSummary(db,int(params.id)));
  add('GET','/api/work-orders/:id/receipts',ROLE_ALL,({params})=>listReceipts(db,int(params.id)));
  add('POST','/api/work-orders/:id/receipts',ROLE_FIN,({params,body,user})=>addReceipt(db,int(params.id),{...body,createdBy:user.id}));
  add('POST','/api/work-orders/:id/receipts/:receiptId/reverse',ROLE_FIN,({params,body})=>reverseReceipt(db,int(params.id),int(params.receiptId),body));
  add('GET','/api/expenses',ROLE_FIN,({url})=>listExpenses(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));
  add('POST','/api/expenses',ROLE_FIN,({body})=>createExpense(db,body));
  add('PATCH','/api/expenses/:id',ROLE_FIN,({params,body})=>updateExpense(db,int(params.id),body));
  add('GET','/api/finance/summary',ROLE_FIN,({url})=>financeSummary(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));
  add('GET','/api/admin/reconciliation',['ADMIN'],()=>auditInvariants(db));
  add('GET','/api/commands/status',ROLE_ALL,({user,url})=>{
    const method=url.searchParams.get('method'),path=url.searchParams.get('path'),requestId=url.searchParams.get('requestId');
    if(!['POST','PATCH','PUT','DELETE'].includes(method)||!path?.startsWith('/api/')||!/^[\\w:.-]{3,128}$/.test(requestId||''))throw new Error('Consulta de operação inválida');
    const scope=`http:${method}:${path}:user:${user.id}`;
    const found=db.prepare('SELECT 1 FROM command_idempotency WHERE scope=? AND request_id=?').get(scope,requestId);
    return {status:found?'CONFIRMED':'UNKNOWN',requestId};
  });
  add('GET','/api/dashboard',ROLE_ALL,({user})=>dashboardData(db,{role:user.role}));
  return r;
}

function serveStatic(req,res,path){
  let rel=path==='/'?'index.html':path.slice(1); if(rel.includes('..'))return false; const file=join(publicDir,rel); if(!existsSync(file)||!statSync(file).isFile())return false;
  res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream','Cache-Control':rel==='index.html'?'no-cache':'public, max-age=3600'});res.end(readFileSync(file));return true;
}

export function createAppServer({db=openDatabase(),storageDir=process.env.STORAGE_DIR||'./storage/uploads',eventRuntime=null}={}){
  migrate(db); const router=createRouter({db,storageDir});
  return createServer(async(req,res)=>{
    const url=new URL(req.url||'/','http://localhost'); const route=router.match(req.method||'GET',url.pathname);
    try{
      if(route){let user=null,token=tokenFrom(req);if(!route.publicRoute){user=validateSession(db,token);roleGuard(user,route.roles)}const body=['POST','PUT','PATCH'].includes(req.method||'')?await readJson(req):{};
        const isMutation=['POST','PUT','PATCH','DELETE'].includes(req.method||'');
        const invoke=()=>route.handler({req,res,url,params:route.params,body,user,token,db});
        // Uma confirmação: comando de negócio + registro de evento imutável.
        const data=isMutation?transaction(db,()=>{
          // Nunca persistir tokens de login/segredos no cache de respostas idempotentes.
          const securityRoute=['/api/auth/login','/api/auth/logout','/api/setup/initialize'].includes(url.pathname);
          const output=securityRoute?invoke():runIdempotent(db,
            `http:${req.method}:${url.pathname}:user:${user?.id??'public'}`,
            body.requestId??req.headers['idempotency-key'],{body},invoke);
          if(!res.writableEnded)enqueueHttpEvent(db,req.method,url.pathname,output,{requestId:body.requestId??req.headers['idempotency-key'],actorId:user?.id??null});
          return output;
        }):invoke();
        if(res.writableEnded)return;
        if(isMutation&&eventRuntime)void dispatchOutbox(db,eventRuntime).catch(e=>console.error('[outbox]',e.message));
        if(data&&Object.hasOwn(data,'__html'))return html(res,200,data.__html);
        if(data&&Object.hasOwn(data,'__binary')){
          res.writeHead(200,{'Content-Type':data.mimeType||'application/octet-stream','Content-Disposition':`inline; filename=\"${String(data.filename||'anexo').replace(/[\"\r\n]/g,'')}\"`,'Cache-Control':'private, max-age=300'});
          return res.end(data.__binary);
        }
        return json(res,200,data??{ok:true});
      }
      if((req.method==='GET'||req.method==='HEAD')&&serveStatic(req,res,url.pathname))return;
      if(req.method==='GET'&&!url.pathname.startsWith('/api/')){if(serveStatic(req,res,'/'))return}
      json(res,404,{error:'Rota não encontrada'});
    }catch(error){console.error('[request]',req.method,url.pathname,error.message);json(res,statusFor(error),{error:error.message||'Erro interno'})}
  });
}

