import { createServer } from 'node:http';
import {publicErrorMessage} from './platform/public-errors.js';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrate, nowIso, transaction } from './db.js';
import {enqueueHttpEvent,dispatchOutbox} from './platform/outbox.js';
import {runIdempotent} from './platform/idempotency.js';
import {auditInvariants} from './services/reconciliation.js';
import {duplicateWorkOrderWithQuote} from './services/work-order-duplication.js';
import {getCompanySettings,updateCompanySettings,listStaffUsers,createStaffUser,updateStaffUser} from './services/admin.js';
import { loginHttp, logout, validateSession } from './auth.js';
import {authTokenFrom,assertSameOrigin,prefersCookie,issueBrowserCookie,clearBrowserCookie,hardenHttpResponse} from './platform/session-http.js';
import {assertSecureNetwork} from './platform/network.js';
import { createCustomer, listCustomers, listCustomersPage,  updateCustomer, getCustomer, createMachine, listMachines, listMachinesPage,  updateMachine, getMachine, createTechnician, listTechnicians, updateTechnician } from './services/catalog.js';
import { createWorkOrder, listWorkOrders, listWorkOrdersPage, getWorkOrder, updateWorkOrder, transitionWorkOrder, getWorkOrderHistory, machineHistory } from './services/work-orders.js';
import { saveQuote, getQuote, submitQuote, approveQuote, rejectQuote } from './services/quotes.js';
import { renderDocument, renderPdfDocument, renderDiagnosticPdf } from './documents.js';
import {listDiagnosticAdapters} from './services/diagnostics.js';
import {executeDiagnosticWorker,isLocalHardwareRequest} from './platform/diagnostic-hardware.js';
import { createPart, listParts, listPartsPage,  updatePart, addInventoryMovement, consumePart, reverseWorkOrderPart, listWorkOrderParts, lowStockParts } from './services/inventory.js';
import { createScheduleEvent, listSchedule, listSchedulePage,  updateScheduleEvent, createChecklistTemplate, getChecklistTemplate, listChecklistTemplates, createWorkOrderChecklist, listWorkOrderChecklists, saveAttachment, listAttachments } from './services/operations.js';
import { saveRemoteAttachment, readRemoteAttachment } from './platform/remote-attachments.js';
import {createCommonDataAdapter} from './platform/common-data-adapter.js';
import {createPaymentCollection} from './platform/payment-collection.js';
import {createBillingService} from './platform/billing-p3-p4.js';
import { addReceipt, reverseReceipt, listReceipts, getPaymentSummary, createExpense, updateExpense, listExpenses, listExpensesPage,  financeSummary } from './services/finance.js';
import { dashboardData } from './services/dashboard.js';
import { getOperationalReport } from './services/reports.js';
import { createFiscalDraft, getFiscalDocument, listFiscalDocuments, listFiscalDocumentsPage, listFiscalEvents,  submitFiscalDocument, reconcileFiscalDocument } from './services/fiscal.js';
import { getFiscalSettings, setFiscalSettings } from './services/fiscal-settings.js';
import { seed } from './seed.js';
import {listServiceRecords,createServiceRecord} from './services/vehicle-maintenance.js';
import {savePartFitment,listPartFitments,deletePartFitment,listCompatibleParts,createDiagnosticScan,listDiagnosticScans,
  createMaintenancePlan,listMaintenancePlans,listMaintenanceAlerts,completeMaintenancePlan} from './services/automotive.js';
import {isSetupRequired,initializeAdmin} from './setup.js';
import {lookupVehicleByPlate,createCrmTask,listCrmTasks,completeCrmTask,createMaintenanceCrmTasks,createShopUnit,listShopUnits,assignWorkOrderUnit,unitReport,createFleet,addFleetVehicle,listFleets,createTechnicalReference,listTechnicalReferences,createApprovalLink,getApprovalProposal,resolveApproval} from './services/market-parity.js';

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
const tokenFrom=authTokenFrom;
function statusFor(error){const m=String(error?.message||'');if(/Versão obrigatória/.test(m))return 428;if(/Muitas tentativas/.test(m))return 429;if(/Credenciais|Sessão/.test(m))return 401;if(/Origem|HTTPS obrigatório/.test(m))return 403;if(/Permissão/.test(m))return 403;if(/não encontrad|não encontrado|não encontrada/i.test(m))return 404;if(/Transição inválida|não pode|já |insuficiente|saldo pendente|não aguarda|UNIQUE constraint|pertence|Conflito de versão/i.test(m))return 409;return 400}
function roleGuard(user,roles){if(!roles||roles.length===0)return;if(!user||!roles.includes(user.role))throw new Error('Permissão insuficiente')}
const int=(v)=>{const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error('Identificador inválido');return n};
function requireVersion(body){
 const version=Number(body?.expectedVersion);
 if(!Number.isSafeInteger(version)||version<1)
   throw new Error('Versão obrigatória: recarregue a OS antes de salvar');
 return version;
}

function createRouter({db,storageDir,objectStore=null,diagnosticRunner=executeDiagnosticWorker}){
  const r=new Router(); const add=(m,p,roles,h,o)=>r.add(m,p,roles,h,o);
  add('GET','/api/health',null,()=>({ok:true}),{publicRoute:true});
  add('GET','/api/setup/status',null,()=>({required:isSetupRequired(db)}),{publicRoute:true});
  add('POST','/api/setup/initialize',null,({req,body})=>initializeAdmin(db,req,body),{publicRoute:true});
  add('POST','/api/auth/login',null,({req,body})=>loginHttp(db,body.username,body.password,{remoteAddress:req.socket.remoteAddress}),{publicRoute:true});
  add('POST','/api/auth/logout',ROLE_ALL,({token})=>{logout(db,token);return {ok:true}});
  add('GET','/api/auth/me',ROLE_ALL,({user})=>user);

  add('GET','/api/company',ROLE_ALL,()=>getCompanySettings(db));
  add('PATCH','/api/company',['ADMIN'],({body})=>updateCompanySettings(db,body));
  add('GET','/api/users',['ADMIN'],()=>listStaffUsers(db));
  add('POST','/api/users',['ADMIN'],({body})=>createStaffUser(db,body));
  add('PATCH','/api/users/:id',['ADMIN'],({params,body})=>updateStaffUser(db,int(params.id),body));

  add('GET','/api/customers/page',ROLE_ALL,({url})=>listCustomersPage(db,{includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||'',limit:url.searchParams.get('limit')||50,cursor:url.searchParams.get('cursor')}));
  add('GET','/api/customers',ROLE_ALL,({url})=>listCustomers(db,{includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||''}));
  add('POST','/api/customers',ROLE_OFFICE,({body})=>createCustomer(db,body));
  add('GET','/api/customers/:id',ROLE_ALL,({params})=>getCustomer(db,int(params.id)));
  add('PATCH','/api/customers/:id',ROLE_OFFICE,({params,body})=>updateCustomer(db,int(params.id),body));
  add('GET','/api/machines/page',ROLE_ALL,({url})=>listMachinesPage(db,{customerId:url.searchParams.get('customerId')?int(url.searchParams.get('customerId')):undefined,includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||'',limit:url.searchParams.get('limit')||50,cursor:url.searchParams.get('cursor')}));
  add('GET','/api/machines',ROLE_ALL,({url})=>listMachines(db,{customerId:url.searchParams.get('customerId')?int(url.searchParams.get('customerId')):undefined,includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||''}));
  add('POST','/api/machines',ROLE_OFFICE,({body})=>createMachine(db,body));
  add('GET','/api/machines/:id',ROLE_ALL,({params})=>getMachine(db,int(params.id)));
  add('PATCH','/api/machines/:id',ROLE_OFFICE,({params,body})=>updateMachine(db,int(params.id),body));
  add('GET','/api/machines/:id/history',ROLE_ALL,({params})=>machineHistory(db,int(params.id)));
  add('GET','/api/machines/:id/maintenance',ROLE_ALL,({params})=>listServiceRecords(db,int(params.id)));
  add('POST','/api/machines/:id/maintenance',ROLE_OFFICE,({params,body})=>createServiceRecord(db,int(params.id),body));
  add('GET','/api/machines/:id/compatible-parts',ROLE_ALL,({params})=>listCompatibleParts(db,int(params.id)));
  add('GET','/api/diagnostics/adapters',ROLE_ALL,()=>listDiagnosticAdapters());
  // A ponte física só opera no computador principal, jamais através de acesso LAN.
  add('GET','/api/diagnostics/hardware',ROLE_TECH,({req})=>{
    if(!isLocalHardwareRequest(req))throw new Error('Permissão: diagnóstico físico somente no computador principal');
    return diagnosticRunner('probe');
  });
  add('GET','/api/diagnostics/capture',ROLE_TECH,({req,url})=>{
    if(!isLocalHardwareRequest(req))throw new Error('Permissão: diagnóstico físico somente no computador principal');
    const params=Object.fromEntries(url.searchParams);
    return diagnosticRunner('capture',params);
  });
  add('GET','/api/machines/:id/obd-scans',ROLE_ALL,({params})=>listDiagnosticScans(db,int(params.id)));
  add('GET','/api/machines/:id/obd-scans/:scanId/pdf',ROLE_ALL,({params})=>({__binary:renderDiagnosticPdf(db,int(params.id),int(params.scanId)),mimeType:'application/pdf',filename:'Diagnostico-'+int(params.scanId)+'.pdf'}));
  add('POST','/api/machines/:id/obd-scans',ROLE_TECH,({params,body})=>createDiagnosticScan(db,int(params.id),body));
  add('GET','/api/machines/:id/maintenance-plans',ROLE_ALL,({params})=>listMaintenancePlans(db,int(params.id)));
  add('POST','/api/machines/:id/maintenance-plans',ROLE_OFFICE,({params,body})=>createMaintenancePlan(db,int(params.id),body));
  add('POST','/api/maintenance-plans/:id/complete',ROLE_TECH,({params,body})=>completeMaintenancePlan(db,int(params.id),body));
  add('GET','/api/maintenance-alerts',ROLE_ALL,()=>listMaintenanceAlerts(db));
  add('GET','/api/technicians',ROLE_ALL,()=>listTechnicians(db,{includeInactive:true}));
  add('POST','/api/technicians',['ADMIN'],({body})=>createTechnician(db,body));
  add('PATCH','/api/technicians/:id',['ADMIN'],({params,body})=>updateTechnician(db,int(params.id),body));

  add('GET','/api/work-orders',ROLE_ALL,({url})=>listWorkOrders(db,{status:url.searchParams.get('status')||undefined,scope:url.searchParams.get('scope')||undefined,search:url.searchParams.get('search')||'',limit:url.searchParams.get('limit')||undefined,offset:url.searchParams.get('offset')||0}));
  add('GET','/api/work-orders/page',ROLE_ALL,({url})=>listWorkOrdersPage(db,{status:url.searchParams.get('status')||'',scope:url.searchParams.get('scope')||'',search:url.searchParams.get('search')||'',cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')||60}));
  add('POST','/api/work-orders',ROLE_OFFICE,({body,user})=>createWorkOrder(db,{...body,createdBy:user.id}));
  add('POST','/api/work-orders/:id/duplicate',ROLE_OFFICE,({params,body,user})=>
    duplicateWorkOrderWithQuote(db,int(params.id),body,{createdBy:user.id}));
  add('GET','/api/work-orders/:id',ROLE_ALL,({params})=>getWorkOrder(db,int(params.id)));
  add('PATCH','/api/work-orders/:id',ROLE_TECH,({params,body,user})=>updateWorkOrder(db,int(params.id),{...body,expectedVersion:requireVersion(body)},{changedBy:user.id}));
  add('POST','/api/work-orders/:id/status',ROLE_TECH,({params,body,user})=>transitionWorkOrder(db,int(params.id),body.status,{reason:body.reason,changedBy:user.id,expectedVersion:requireVersion(body)}));
  add('GET','/api/work-orders/:id/history',ROLE_ALL,({params})=>getWorkOrderHistory(db,int(params.id)));

  add('GET','/api/work-orders/:id/quote',ROLE_ALL,({params})=>getQuote(db,int(params.id)));
  add('PUT','/api/work-orders/:id/quote',ROLE_OFFICE,({params,body})=>saveQuote(db,int(params.id),body));
  add('POST','/api/work-orders/:id/quote/submit',ROLE_OFFICE,({params})=>submitQuote(db,int(params.id)));
  add('POST','/api/work-orders/:id/quote/approve',ROLE_OFFICE,({params})=>approveQuote(db,int(params.id)));
  add('POST','/api/work-orders/:id/quote/reject',ROLE_OFFICE,({params,body})=>rejectQuote(db,int(params.id),body.reason));
  add('GET','/api/work-orders/:id/documents/:kind/pdf',ROLE_ALL,({params})=>{const id=int(params.id),os=getWorkOrder(db,id);return {__binary:renderPdfDocument(db,id,params.kind),mimeType:'application/pdf',filename:`OS-${os.os_number}.pdf`}});
  add('GET','/api/work-orders/:id/documents/:kind',ROLE_ALL,({params})=>({__html:renderDocument(db,int(params.id),params.kind)}));

  add('GET','/api/parts/page',ROLE_ALL,({url})=>listPartsPage(db,{includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||'',limit:url.searchParams.get('limit')||50,cursor:url.searchParams.get('cursor')}));
  add('GET','/api/parts',ROLE_ALL,({url})=>listParts(db,{includeInactive:url.searchParams.get('includeInactive')==='1',search:url.searchParams.get('search')||''}));
  add('POST','/api/parts',ROLE_OFFICE,({body})=>createPart(db,body));
  add('GET','/api/parts/:id/fitments',ROLE_ALL,({params})=>listPartFitments(db,int(params.id)));
  add('POST','/api/parts/:id/fitments',ROLE_OFFICE,({params,body})=>savePartFitment(db,int(params.id),body));
  add('DELETE','/api/parts/:id/fitments/:fitmentId',ROLE_OFFICE,({params})=>deletePartFitment(db,int(params.id),int(params.fitmentId)));
  add('PATCH','/api/parts/:id',ROLE_OFFICE,({params,body})=>updatePart(db,int(params.id),body));
  add('POST','/api/inventory/movements',ROLE_OFFICE,({body,user})=>addInventoryMovement(db,int(body.partId),{...body,createdBy:user.id,userRole:user.role}));
  add('GET','/api/inventory/low-stock',ROLE_ALL,()=>lowStockParts(db));
  add('GET','/api/work-orders/:id/parts',ROLE_ALL,({params})=>listWorkOrderParts(db,int(params.id)));
  add('POST','/api/work-orders/:id/parts',ROLE_TECH,({params,body,user})=>consumePart(db,int(params.id),int(body.partId),{...body,createdBy:user.id,userRole:user.role}));
  add('POST','/api/work-orders/:id/parts/:itemId/reverse',ROLE_TECH,({params,body,user})=>reverseWorkOrderPart(db,int(params.itemId),{note:body.note,createdBy:user.id,workOrderId:int(params.id)}));

  add('GET','/api/schedule/page',ROLE_ALL,({url})=>listSchedulePage(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined,limit:url.searchParams.get('limit')||50,cursor:url.searchParams.get('cursor')}));
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
  add('GET','/api/attachments/:id/file',ROLE_ALL,async({params})=>{
    const a=db.prepare('SELECT * FROM attachments WHERE id=?').get(int(params.id));
    if(!a)throw new Error('Anexo não encontrado');
    if(a.relative_path.startsWith('s3:')){
      return {__binary:await readRemoteAttachment(a,objectStore),mimeType:a.mime_type,filename:a.original_name};
    }
    const root=resolve(storageDir),file=resolve(root,a.relative_path);
    if(file!==root&&!file.startsWith(root+sep))throw new Error('Caminho de anexo inválido');
    if(!existsSync(file))throw new Error('Arquivo de anexo não encontrado');
    return {__binary:readFileSync(file),mimeType:a.mime_type,filename:a.original_name};
  });

  add('GET','/api/work-orders/:id/payment',ROLE_ALL,({params})=>getPaymentSummary(db,int(params.id)));
  add('GET','/api/work-orders/:id/receipts',ROLE_ALL,({params})=>listReceipts(db,int(params.id)));
  add('POST','/api/work-orders/:id/receipts',ROLE_FIN,({params,body,user})=>addReceipt(db,int(params.id),{...body,createdBy:user.id}));
  add('POST','/api/work-orders/:id/receipts/:receiptId/reverse',ROLE_FIN,({params,body})=>reverseReceipt(db,int(params.id),int(params.receiptId),body));
  add('GET','/api/expenses/page',ROLE_FIN,({url})=>listExpensesPage(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined,limit:url.searchParams.get('limit')||50,cursor:url.searchParams.get('cursor')}));
  add('GET','/api/expenses',ROLE_FIN,({url})=>listExpenses(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));
  add('POST','/api/expenses',ROLE_FIN,({body})=>createExpense(db,body));
  add('PATCH','/api/expenses/:id',ROLE_FIN,({params,body})=>updateExpense(db,int(params.id),body));
  add('GET','/api/finance/summary',ROLE_FIN,({url})=>financeSummary(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined}));
  add('GET','/api/reports',ROLE_ALL,({url,user})=>getOperationalReport(db,{from:url.searchParams.get('from')||undefined,to:url.searchParams.get('to')||undefined,includeFinance:ROLE_FIN.includes(user.role)}));
  add('GET','/api/fiscal/page',ROLE_FIN,({url})=>listFiscalDocumentsPage(db,{status:url.searchParams.get('status')||'',limit:url.searchParams.get('limit')||50,cursor:url.searchParams.get('cursor')}));
  add('GET','/api/fiscal',ROLE_FIN,({url})=>listFiscalDocuments(db,{status:url.searchParams.get('status')||'',limit:url.searchParams.get('limit')||100}));
  add('GET','/api/fiscal/settings',ROLE_FIN,()=>getFiscalSettings(db));
  add('PATCH','/api/fiscal/settings',['ADMIN'],({body})=>setFiscalSettings(db,body));
  add('POST','/api/fiscal/drafts',ROLE_FIN,({body})=>createFiscalDraft(db,body));
  add('GET','/api/fiscal/:id',ROLE_FIN,({params})=>getFiscalDocument(db,int(params.id)));
  add('GET','/api/fiscal/:id/events',ROLE_FIN,({params})=>listFiscalEvents(db,int(params.id)));
  add('GET','/api/fiscal/:id/xml',ROLE_FIN,({params})=>{const doc=getFiscalDocument(db,int(params.id));if(!['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(doc.status)||!doc.authorized_xml)throw new Error('Documento sem XML fiscal autorizado');return {__binary:Buffer.from(doc.authorized_xml,'utf8'),mimeType:'application/xml; charset=utf-8',filename:doc.kind+'-'+doc.id+'.xml'}});
  add('GET','/api/admin/reconciliation',['ADMIN'],()=>auditInvariants(db));
  add('GET','/api/commands/status',ROLE_ALL,({user,url})=>{
    const method=url.searchParams.get('method'),path=url.searchParams.get('path'),requestId=url.searchParams.get('requestId');
    if(!['POST','PATCH','PUT','DELETE'].includes(method)||!path?.startsWith('/api/')||!/^[A-Za-z0-9_:.-]{3,128}$/.test(requestId||''))throw new Error('Consulta de operação inválida');
    const scope=`http:${method}:${path}:user:${user.id}`;
    const found=db.prepare('SELECT result_json FROM command_idempotency WHERE scope=? AND request_id=?').get(scope,requestId);
    return {status:found?'CONFIRMED':'UNKNOWN',requestId,...(found?{result:JSON.parse(found.result_json)}:{})};
  });
  // Paridade competitiva: todas as mutações internas mantêm autenticação e RBAC.
  add('GET','/api/vehicles/plate/:plate',ROLE_ALL,({params})=>lookupVehicleByPlate(db,params.plate));
  add('GET','/api/crm/tasks',ROLE_ALL,({url})=>listCrmTasks(db,{status:url.searchParams.get('status')||'PENDENTE'}));
  add('POST','/api/crm/tasks',ROLE_OFFICE,({body})=>createCrmTask(db,body));
  add('POST','/api/crm/tasks/:id/complete',ROLE_OFFICE,({params,body})=>completeCrmTask(db,int(params.id),body));
  add('POST','/api/crm/maintenance/sync',ROLE_OFFICE,({body})=>createMaintenanceCrmTasks(db,body));
  add('GET','/api/units',ROLE_ALL,()=>listShopUnits(db));
  add('POST','/api/units',['ADMIN'],({body})=>createShopUnit(db,body));
  add('POST','/api/units/assign',['ADMIN'],({body})=>assignWorkOrderUnit(db,int(body.workOrderId),int(body.unitId)));
  add('GET','/api/units/report',ROLE_FIN,()=>unitReport(db));
  add('GET','/api/fleets',ROLE_ALL,()=>listFleets(db));
  add('POST','/api/fleets',ROLE_OFFICE,({body})=>createFleet(db,body));
  add('POST','/api/fleets/:id/vehicles',ROLE_OFFICE,({params,body})=>addFleetVehicle(db,int(params.id),int(body.machineId)));
  add('GET','/api/technical-references',ROLE_ALL,({url})=>listTechnicalReferences(db,{partId:url.searchParams.get('partId')?int(url.searchParams.get('partId')):undefined}));
  add('POST','/api/technical-references',ROLE_OFFICE,({body})=>createTechnicalReference(db,body));
  add('POST','/api/work-orders/:id/quote/approval-link',ROLE_OFFICE,({params,body})=>createApprovalLink(db,int(params.id),body));
  // O token de aprovação é o único segredo necessário para a interação pública.
  add('GET','/api/public/approval/:token',null,({params})=>getApprovalProposal(db,params.token),{publicRoute:true});
  add('POST','/api/public/approval/:token',null,({params,body})=>resolveApproval(db,params.token,body),{publicRoute:true});
  add('GET','/api/dashboard',ROLE_ALL,({user})=>dashboardData(db,{role:user.role}));
  return r;
}

function serveStatic(req,res,path){
  let rel=path==='/'?'index.html':path.slice(1); if(rel.includes('..'))return false; const file=join(publicDir,rel); if(!existsSync(file)||!statSync(file).isFile())return false;
  res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream','Cache-Control':rel==='index.html'?'no-cache':'public, max-age=3600'});res.end(readFileSync(file));return true;
}

export function createAppServer({db=openDatabase(),storageDir=process.env.STORAGE_DIR||'./storage/uploads',eventRuntime=null,fiscalProvider=null,objectStore=null,diagnosticRunner=executeDiagnosticWorker,paymentOptions=null}={}){
  migrate(db); const router=createRouter({db,storageDir,objectStore,diagnosticRunner});
  const paymentIntents=createPaymentCollection(createCommonDataAdapter({engine:'sqlite',db}),{
    receivePayment:input=>addReceipt(db,input.workOrderId,input),
    getPaymentSummary:workOrderId=>getPaymentSummary(db,workOrderId),
    ...(paymentOptions??{})
  });
  const billing=createBillingService(createCommonDataAdapter({engine:'sqlite',db}),{
    receivePayment:input=>addReceipt(db,input.workOrderId,input),
    getPaymentSummary:workOrderId=>getPaymentSummary(db,workOrderId),
    providers:paymentOptions?.billingProviders??{}
  });
  return createServer(async(req,res)=>{
    const url=new URL(req.url||'/','http://localhost'); const route=router.match(req.method||'GET',url.pathname);
    hardenHttpResponse(res,req);
    try{
      assertSecureNetwork(req);
      assertSameOrigin(req);
      if(url.pathname==='/api/payment-intents/capabilities'||
         url.pathname==='/api/payment-intents'||
         /^\/api\/payment-intents\/[a-f0-9]{32}(?:\/sync)?$/.test(url.pathname)){
        const user=validateSession(db,tokenFrom(req));roleGuard(user,ROLE_FIN);
        if(req.method==='GET'&&url.pathname==='/api/payment-intents/capabilities')
          return json(res,200,paymentIntents.getCapabilities());
        if(req.method==='POST'&&url.pathname==='/api/payment-intents'){
          const data=await readJson(req,16384);
          return json(res,201,await paymentIntents.createIntent({
            ...data,requestId:data.requestId??req.headers['idempotency-key']
          }));
        }
        const view=url.pathname.match(/^\/api\/payment-intents\/([a-f0-9]{32})$/);
        if(view&&req.method==='GET')
          return json(res,200,await paymentIntents.getIntent(view[1]));
        const sync=url.pathname.match(/^\/api\/payment-intents\/([a-f0-9]{32})\/sync$/);
        if(sync&&req.method==='POST')
          return json(res,200,await paymentIntents.syncIntent(sync[1]));
        return json(res,405,{error:'Método não permitido'});
      }
      if(url.pathname.startsWith('/api/billing/')){
        const user=validateSession(db,tokenFrom(req));roleGuard(user,ROLE_FIN);
        const method=req.method,path=url.pathname;
        const body=method==='POST'?await readJson(req,16384):{};
        const data={...body,requestId:body.requestId??req.headers['idempotency-key']};
        const capture=pattern=>path.match(pattern);
        let result;
        if(method==='POST'&&path==='/api/billing/plans')result=await billing.createPlan(data);
        else if(method==='GET'&&path==='/api/billing/capabilities')result=billing.capabilities();
        else if(method==='GET'&&path==='/api/billing/report')result=await billing.financeReport({asOf:url.searchParams.get('asOf')||undefined});
        else if(method==='GET'&&path==='/api/billing/statements')result=await billing.listStatements({limit:url.searchParams.get('limit')||100});
        else if(method==='POST'&&path==='/api/billing/statements')result=await billing.importStatement(data);
        else if(method==='POST'&&path==='/api/billing/settlements')result=await billing.recordSettlement(data);
        else if(method==='POST'&&path==='/api/billing/reminders/prepare')result=await billing.prepareReminders(data);
        else if(method==='GET'&&capture(/^\/api\/billing\/orders\/([1-9]\d*)\/plan$/))
          result=await billing.getPlanForOrder(Number(capture(/^\/api\/billing\/orders\/([1-9]\d*)\/plan$/)[1]));
        else if(method==='GET'&&capture(/^\/api\/billing\/plans\/([a-f0-9]{32})$/))
          result=await billing.getPlan(capture(/^\/api\/billing\/plans\/([a-f0-9]{32})$/)[1]);
        else if(method==='POST'&&capture(/^\/api\/billing\/installments\/([a-f0-9]{32})\/(activate|sync|manual)$/)){
          const [,id,action]=capture(/^\/api\/billing\/installments\/([a-f0-9]{32})\/(activate|sync|manual)$/);
          result=await (action==='activate'?billing.activateInstallment(id):action==='sync'?billing.syncInstallment(id):billing.confirmManual(id,data));
        }else if(method==='POST'&&capture(/^\/api\/billing\/statements\/([a-f0-9]{32})\/match$/))
          result=await billing.matchStatement(capture(/^\/api\/billing\/statements\/([a-f0-9]{32})\/match$/)[1],data.receiptId);
        else return json(res,404,{error:'Rota financeira não encontrada'});
        return json(res,200,result);
      }
      // S3 is async: upload before committing metadata, but never await while
      // inside a synchronous SQLite transaction. Local/disk mode is unchanged.
      const attachmentUpload=objectStore&&req.method==='POST'
        ?url.pathname.match(/^\/api\/work-orders\/(\d+)\/attachments$/):null;
      if(attachmentUpload){
        const user=validateSession(db,tokenFrom(req));
        roleGuard(user,ROLE_TECH);
        const body=await readJson(req);
        const workOrderId=int(attachmentUpload[1]);
        const data=await saveRemoteAttachment(db,workOrderId,{
          ...body,requestId:body.requestId??req.headers['idempotency-key']
        },{objectStore,onPersist:row=>enqueueHttpEvent(db,'POST',url.pathname,row,{
          requestId:body.requestId??req.headers['idempotency-key'],actorId:user.id
        })});
        if(eventRuntime)void dispatchOutbox(db,eventRuntime,100,{respectBackoff:true})
          .catch(e=>console.error('[outbox]',e.message));
        return json(res,200,data);
      }
      // Transmissão fiscal faz I/O externo; nunca manter transação SQLite aberta durante a rede.
      // Rotas assíncronas são separadas do envelopamento HTTP de comandos síncronos.
      const fiscalAction=(req.method==='POST')?url.pathname.match(/^\/api\/fiscal\/(\d+)\/(submit|reconcile)$/):null;
      if(fiscalAction){
        const user=validateSession(db,tokenFrom(req));roleGuard(user,ROLE_FIN);
        await readJson(req);
        const id=int(fiscalAction[1]);
        const data=fiscalAction[2]==='submit'
          ? await submitFiscalDocument(db,id,{provider:fiscalProvider})
          : await reconcileFiscalDocument(db,id,{provider:fiscalProvider});
        return json(res,200,data);
      }
      if(route){let user=null,token=tokenFrom(req);if(!route.publicRoute){user=validateSession(db,token);roleGuard(user,route.roles)}const body=['POST','PUT','PATCH'].includes(req.method||'')?await readJson(req):{};
        const isMutation=['POST','PUT','PATCH','DELETE'].includes(req.method||'');
        const invoke=()=>route.handler({req,res,url,params:route.params,body,user,token,db});
        // Login nunca entra na transação síncrona nem no cache de respostas.
        if(req.method==='POST'&&url.pathname==='/api/auth/login'){
          const identity=await invoke();
          if(prefersCookie(req)){
            issueBrowserCookie(res,req,identity.token);
            return json(res,200,{user:identity.user,expiresAt:identity.expiresAt});
          }
          return json(res,200,identity);
        }
        // Uma confirmação: comando de negócio + registro de evento imutável.
        const data=isMutation?transaction(db,()=>{
          // Nunca persistir tokens de login/segredos no cache de respostas idempotentes.
          const sensitiveApprovalRoute=req.method==='POST'&&/^\/api\/work-orders\/\d+\/quote\/approval-link$/.test(url.pathname);
           const securityRoute=sensitiveApprovalRoute||['/api/auth/login','/api/auth/logout','/api/setup/initialize'].includes(url.pathname);
          const publicApprovalRoute=url.pathname.startsWith('/api/public/approval/');
           const output=(securityRoute||publicApprovalRoute)?invoke():runIdempotent(db,
            `http:${req.method}:${url.pathname}:user:${user?.id??'public'}`,
            body.requestId??req.headers['idempotency-key'],{body},invoke);
          if(!res.writableEnded&&!publicApprovalRoute&&!sensitiveApprovalRoute)enqueueHttpEvent(db,req.method,url.pathname,output,{requestId:body.requestId??req.headers['idempotency-key'],actorId:user?.id??null});
          return output;
        }):await invoke();
        if(res.writableEnded)return;
        if(req.method==='POST'&&url.pathname==='/api/auth/logout')clearBrowserCookie(res,req);
        if(isMutation&&eventRuntime)void dispatchOutbox(db,eventRuntime,100,{respectBackoff:true}).catch(e=>console.error('[outbox]',e.message));
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
    }catch(error){console.error('[request]',req.method,url.pathname.startsWith('/api/public/approval/')?'/api/public/approval/[redacted]':url.pathname,error.message);json(res,statusFor(error),{error:publicErrorMessage(error)})}
  });
}

