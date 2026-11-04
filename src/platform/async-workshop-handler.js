// Private service-to-service HTTP boundary for native async D1/PG operations.
// No arbitrary SQL endpoint, browser CORS allowance or client-side secrets.
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const constantTimeToken=(actual,expected)=>{
  if(typeof actual!=='string'||typeof expected!=='string')return false;
  let mismatch=actual.length^expected.length;
  const size=Math.max(actual.length,expected.length);
  for(let i=0;i<size;i++)mismatch|=(actual.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);
  return mismatch===0;
};
async function dataFrom(request){
 if(!String(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
   throw Object.assign(new Error('Corpo JSON obrigatório'),{status:415});
 if(Number(request.headers.get('content-length')||0)>1048576)
   throw Object.assign(new Error('Requisição excede limite'),{status:413});
 const raw=await request.text();
 if(raw.length>1048576)throw Object.assign(new Error('Requisição excede limite'),{status:413});
 let data;try{data=JSON.parse(raw);}catch{throw Object.assign(new Error('JSON inválido'),{status:400});}
 if(!data||typeof data!=='object'||Array.isArray(data))
   throw Object.assign(new Error('Objeto JSON obrigatório'),{status:400});
 return data;
}
export function createAsyncWorkshopHandler({services,serviceToken,migrate=null,preflight=null}={}){
 if(!services||typeof services!=='object')throw Error('Serviço SQL assíncrono indisponível');
 if(!serviceToken||String(serviceToken).length<32)
   throw Error('Token privado do backend SQL deve ter ao menos 32 caracteres');
 return async request=>{
  const authorized=constantTimeToken(request.headers.get('authorization')||'',
    'Bearer '+serviceToken);
  if(!authorized)return json({error:'Serviço privado: acesso não autorizado'},401);
  try{
   const u=new URL(request.url),path=u.pathname,method=request.method.toUpperCase();
   // Called only after private Bearer authentication and before ANY
   // operational query; prevents a wrongly mapped company from reading data.
   if(preflight&&path!=='/v1/migrate'&&path!=='/v1/health')
     await preflight();
   if(path==='/v1/health'&&method==='GET')
     return json({ok:true,backend:'async-workshop'});
   if(path==='/v1/migrate'&&method==='POST'&&migrate)
     return json(await migrate());
   if(path==='/v1/auth/bootstrap'&&method==='POST')
     return json(await services.bootstrapAdmin(await dataFrom(request)),201);
   if(path==='/v1/auth/login'&&method==='POST')
     return json(await services.login(await dataFrom(request)));
   if(path==='/v1/auth/users'&&method==='POST'){
     const input=await dataFrom(request);
     if(!input.sessionToken)
       throw Object.assign(new Error('Sessão inválida'),{status:401});
     const {sessionToken,...fields}=input;
     return json(await services.createUser(fields,sessionToken),201);
   }
   if(path==='/v1/auth/logout'&&method==='POST'){
     const {sessionToken}=await dataFrom(request);
     return json(await services.logout(sessionToken));
   }
   if(path==='/v1/customers'&&method==='POST')
     return json(await services.createCustomer(await dataFrom(request)),201);
   if(path==='/v1/customers'&&method==='GET')
     return json(await services.listCustomers({
       search:u.searchParams.get('search')||'',
       includeInactive:u.searchParams.get('includeInactive')==='1',
       limit:u.searchParams.get('limit')||200,
       offset:u.searchParams.get('offset')||0
     }));
   const customer=path.match(/^\/v1\/customers\/([1-9]\d*)$/);
   if(customer&&method==='PATCH')
     return json(await services.updateCustomer(Number(customer[1]),await dataFrom(request)));
   if(path==='/v1/machines'&&method==='POST')
     return json(await services.createMachine(await dataFrom(request)),201);
   if(path==='/v1/machines'&&method==='GET')
     return json(await services.listMachines({
       customerId:u.searchParams.get('customerId')||null,
       search:u.searchParams.get('search')||'',
       includeInactive:u.searchParams.get('includeInactive')==='1'
     }));
   const machine=path.match(/^\/v1\/machines\/([1-9]\d*)$/);
   if(machine&&method==='PATCH')
     return json(await services.updateMachine(Number(machine[1]),await dataFrom(request)));
   if(path==='/v1/technicians'&&method==='GET')
     return json(await services.listTechnicians({includeInactive:true}));
   if(path==='/v1/technicians'&&method==='POST')
     return json(await services.createTechnician(await dataFrom(request)),201);
   if(path==='/v1/orders'&&method==='GET')
     return json(await services.listWorkOrders({
       search:u.searchParams.get('search')||'',
       status:u.searchParams.get('status')||'',
       scope:u.searchParams.get('scope')||'',
       limit:u.searchParams.get('limit')||200,
       offset:u.searchParams.get('offset')||0
     }));
   if(path==='/v1/orders/page'&&method==='GET')
     return json(await services.listWorkOrdersPage({
       search:u.searchParams.get('search')||'',
       status:u.searchParams.get('status')||'',
       scope:u.searchParams.get('scope')||'',
       limit:u.searchParams.get('limit')||60,
       cursor:u.searchParams.get('cursor')
     }));
   if(path==='/v1/orders'&&method==='POST')
     return json(await services.createWorkOrder(await dataFrom(request)),201);
   const order=path.match(/^\/v1\/orders\/([1-9]\d*)$/);
   if(order&&method==='PATCH')
     return json(await services.updateWorkOrder(Number(order[1]),await dataFrom(request)));
   if(order&&method==='GET')
     return json(await services.getWorkOrder(Number(order[1])));
   const orderHistory=path.match(/^\/v1\/orders\/([1-9]\d*)\/history$/);
   if(orderHistory&&method==='GET')
     return json(await services.getWorkOrderHistory(Number(orderHistory[1])));
   const duplicate=path.match(/^\/v1\/orders\/([1-9]\d*)\/duplicate$/);
   if(duplicate&&method==='POST')
     return json(await services.duplicateWorkOrder(Number(duplicate[1]),await dataFrom(request)),201);
   const status=path.match(/^\/v1\/orders\/([1-9]\d*)\/status$/);
   if(status&&method==='POST')
     return json(await services.transitionWorkOrder({
       ...await dataFrom(request),workOrderId:Number(status[1])
     }));
   const quote=path.match(/^\/v1\/orders\/([1-9]\d*)\/quote$/);
   if(quote&&method==='GET')
     return json(await services.getQuote(Number(quote[1])));
   if(quote&&method==='PUT')
     return json(await services.saveQuote({
       ...await dataFrom(request),workOrderId:Number(quote[1])
     }));
   const submit=path.match(/^\/v1\/orders\/([1-9]\d*)\/quote\/submit$/);
   if(submit&&method==='POST')
     return json(await services.submitQuote({workOrderId:Number(submit[1])}));
   const reject=path.match(/^\/v1\/orders\/([1-9]\d*)\/quote\/reject$/);
   if(reject&&method==='POST')
     return json(await services.rejectQuote({
       ...await dataFrom(request),workOrderId:Number(reject[1])
     }));
   const approve=path.match(/^\/v1\/orders\/([1-9]\d*)\/quote\/approve$/);
   if(approve&&method==='POST')
     return json(await services.approveQuote({workOrderId:Number(approve[1])}));
   if(path==='/v1/fiscal/drafts'&&method==='POST')
     return json(await services.createFiscalDraft(await dataFrom(request)),201);

   if(path==='/v1/schedule'&&method==='GET')
     return json(await services.listSchedule({
       from:u.searchParams.get('from')||undefined,
       to:u.searchParams.get('to')||undefined,
       limit:u.searchParams.get('limit')||100
     }));
   if(path==='/v1/schedule'&&method==='POST')
     return json(await services.createScheduleEvent(await dataFrom(request)),201);
   const schedule=path.match(/^\/v1\/schedule\/([1-9]\d*)$/);
   if(schedule&&method==='PATCH')
     return json(await services.updateScheduleEvent(Number(schedule[1]),await dataFrom(request)));
   if(path==='/v1/checklist-templates'&&method==='GET')
     return json(await services.listChecklistTemplates());
   if(path==='/v1/checklist-templates'&&method==='POST')
     return json(await services.createChecklistTemplate(await dataFrom(request)),201);
   const template=path.match(/^\/v1\/checklist-templates\/([1-9]\d*)$/);
   if(template&&method==='GET')
     return json(await services.getChecklistTemplate(Number(template[1])));
   const checklists=path.match(/^\/v1\/orders\/([1-9]\d*)\/checklists$/);
   if(checklists&&method==='GET')
     return json(await services.listWorkOrderChecklists(Number(checklists[1])));
   if(checklists&&method==='POST')
     return json(await services.createWorkOrderChecklist({
       ...await dataFrom(request),workOrderId:Number(checklists[1])
     }),201);
   const checklist=path.match(/^\/v1\/checklists\/([1-9]\d*)$/);
   if(checklist&&method==='GET')
     return json(await services.getWorkOrderChecklist(Number(checklist[1])));
   if(path==='/v1/fiscal/settings'&&method==='GET')
     return json(await services.getFiscalSettings());
   if(path==='/v1/fiscal/settings'&&method==='PATCH')
     return json(await services.setFiscalSettings(await dataFrom(request)));
   if(path==='/v1/fiscal'&&method==='GET')
     return json(await services.listFiscalDocuments({
       status:u.searchParams.get('status')||'',limit:u.searchParams.get('limit')||100
     }));
   const fiscal=path.match(/^\/v1\/fiscal\/([1-9]\d*)$/);
   if(fiscal&&method==='GET')
     return json(await services.getFiscalDocument(Number(fiscal[1])));
   const fiscalEvents=path.match(/^\/v1\/fiscal\/([1-9]\d*)\/events$/);
   if(fiscalEvents&&method==='GET')
     return json(await services.getFiscalEvents(Number(fiscalEvents[1])));
   const fiscalSubmit=path.match(/^\/v1\/fiscal\/([1-9]\d*)\/submit$/);
   if(fiscalSubmit&&method==='POST')
     return json(await services.submitFiscalDocument(Number(fiscalSubmit[1])));
   const fiscalReconcile=path.match(/^\/v1\/fiscal\/([1-9]\d*)\/reconcile$/);
   if(fiscalReconcile&&method==='POST')
     return json(await services.reconcileFiscalDocument(Number(fiscalReconcile[1])));
   if(path==='/v1/services'&&method==='GET')
     return json(await services.listServices({
       search:u.searchParams.get('search')||'',
       includeInactive:u.searchParams.get('includeInactive')==='1'
     }));
   if(path==='/v1/services'&&method==='POST')
     return json(await services.createService(await dataFrom(request)),201);
   if(path==='/v1/cash/open'&&method==='POST')
     return json(await services.openCashSession(await dataFrom(request)),201);
   if(path==='/v1/cash/close'&&method==='POST')
     return json(await services.closeCashSession(await dataFrom(request)));
   if(path==='/v1/cash/summary'&&method==='GET')
     return json(await services.cashSummary());
   if(path==='/v1/sales'&&method==='GET')
     return json(await services.listSales({
       status:u.searchParams.get('status')||'',search:u.searchParams.get('search')||'',
       limit:u.searchParams.get('limit')||100
     }));
   if(path==='/v1/sales'&&method==='POST')
     return json(await services.createSale(await dataFrom(request)),201);
   const sale=path.match(/^\/v1\/sales\/([1-9]\d*)$/);
   if(sale&&method==='GET')
     return json(await services.getSale(Number(sale[1])));
   const saleCancel=path.match(/^\/v1\/sales\/([1-9]\d*)\/cancel$/);
   if(saleCancel&&method==='POST')
     return json(await services.cancelSale({
       ...await dataFrom(request),saleId:Number(saleCancel[1])
     }));
   const fitments=path.match(/^\/v1\/parts\/([1-9]\d*)\/fitments$/);
   if(fitments&&method==='GET')
     return json(await services.listPartFitments(Number(fitments[1])));
   if(fitments&&method==='POST')
     return json(await services.savePartFitment(Number(fitments[1]),
       await dataFrom(request)),201);
   const fitmentDelete=path.match(/^\/v1\/parts\/([1-9]\d*)\/fitments\/([1-9]\d*)$/);
   if(fitmentDelete&&method==='DELETE')
     return json(await services.deletePartFitment(Number(fitmentDelete[1]),
       Number(fitmentDelete[2])));
   const compatible=path.match(/^\/v1\/machines\/([1-9]\d*)\/compatible-parts$/);
   if(compatible&&method==='GET')
     return json(await services.listCompatibleParts(Number(compatible[1])));
   const scans=path.match(/^\/v1\/machines\/([1-9]\d*)\/obd-scans$/);
   if(scans&&method==='GET')
     return json(await services.listDiagnosticScans(Number(scans[1])));
   if(scans&&method==='POST')
     return json(await services.createDiagnosticScan(Number(scans[1]),
       await dataFrom(request)),201);
   const plans=path.match(/^\/v1\/machines\/([1-9]\d*)\/maintenance-plans$/);
   if(plans&&method==='GET')
     return json(await services.listMaintenancePlans(Number(plans[1])));
   if(plans&&method==='POST')
     return json(await services.createMaintenancePlan(Number(plans[1]),
       await dataFrom(request)),201);
   if(path==='/v1/maintenance-alerts'&&method==='GET')
     return json(await services.listMaintenanceAlerts({
       today:u.searchParams.get('today')||undefined,
       limit:u.searchParams.get('limit')||undefined
     }));
   const completePlan=path.match(/^\/v1\/maintenance-plans\/([1-9]\d*)\/complete$/);
   if(completePlan&&method==='POST')
     return json(await services.completeMaintenancePlan(Number(completePlan[1]),
       await dataFrom(request)));
   const maintenance=path.match(/^\/v1\/machines\/([1-9]\d*)\/maintenance$/);
   if(maintenance&&method==='GET')
     return json(await services.listServiceRecords(Number(maintenance[1])));
   if(maintenance&&method==='POST')
     return json(await services.createServiceRecord(Number(maintenance[1]),
       await dataFrom(request)),201);
   const lookupPlate=path.match(/^\/v1\/vehicles\/plate\/([A-Z0-9-]+)$/);
   if(lookupPlate&&method==='GET')
     return json(await services.lookupVehicleByPlate(lookupPlate[1]));
   if(path==='/v1/crm/tasks'&&method==='GET')
     return json(await services.listCrmTasks({
       status:u.searchParams.get('status')||'PENDENTE',
       limit:u.searchParams.get('limit')||200
     }));
   if(path==='/v1/crm/tasks'&&method==='POST')
     return json(await services.createCrmTask(await dataFrom(request)),201);
   const completeTask=path.match(/^\/v1\/crm\/tasks\/([1-9]\d*)\/complete$/);
   if(completeTask&&method==='POST')
     return json(await services.completeCrmTask(Number(completeTask[1]),
       await dataFrom(request)));
   if(path==='/v1/crm/maintenance/sync'&&method==='POST')
     return json(await services.createMaintenanceCrmTasks(await dataFrom(request)));
   if(path==='/v1/fleets'&&method==='GET')
     return json(await services.listFleets());
   if(path==='/v1/fleets'&&method==='POST')
     return json(await services.createFleet(await dataFrom(request)),201);
   const fleetVehicle=path.match(/^\/v1\/fleets\/([1-9]\d*)\/vehicles$/);
   if(fleetVehicle&&method==='POST'){
     const input=await dataFrom(request);
     return json(await services.addFleetVehicle(Number(fleetVehicle[1]),input.machineId));
   }
   if(path==='/v1/technical-references'&&method==='GET')
     return json(await services.listTechnicalReferences({
       partId:u.searchParams.get('partId')||null
     }));
   if(path==='/v1/technical-references'&&method==='POST')
     return json(await services.createTechnicalReference(await dataFrom(request)),201);
   if(path==='/v1/parts'&&method==='GET')
     return json(await services.listParts({
       search:u.searchParams.get('search')||'',
       includeInactive:u.searchParams.get('includeInactive')==='1'
     }));
   if(path==='/v1/parts/page'&&method==='GET')
     return json(await services.listPartsPage({
       search:u.searchParams.get('search')||'',
       includeInactive:u.searchParams.get('includeInactive')==='1',
       cursor:u.searchParams.get('cursor'),limit:u.searchParams.get('limit')||50
     }));
   if(path==='/v1/parts/low-stock'&&method==='GET')
     return json(await services.lowStockParts());
   const part=path.match(/^\/v1\/parts\/([1-9]\d*)$/);
   if(part&&method==='GET')
     return json(await services.getPart(Number(part[1])));
   if(part&&method==='PATCH')
     return json(await services.updatePart(Number(part[1]),await dataFrom(request)));
   const reconcilePart=path.match(/^\/v1\/parts\/([1-9]\d*)\/reconcile$/);
   if(reconcilePart&&method==='GET')
     return json(await services.reconcileStock(Number(reconcilePart[1])));
   const osParts=path.match(/^\/v1\/orders\/([1-9]\d*)\/parts$/);
   if(osParts&&method==='GET')
     return json(await services.listWorkOrderParts(Number(osParts[1])));
   if(osParts&&method==='POST')
     return json(await services.consumePart({
       ...await dataFrom(request),workOrderId:Number(osParts[1])
     }),201);
   const reversePart=path.match(/^\/v1\/orders\/([1-9]\d*)\/parts\/([1-9]\d*)\/reverse$/);
   if(reversePart&&method==='POST')
     return json(await services.reverseWorkOrderPart({
       ...await dataFrom(request),workOrderId:Number(reversePart[1]),
       itemId:Number(reversePart[2])
     }));
   if(path==='/v1/parts'&&method==='POST')
     return json(await services.createPart(await dataFrom(request)),201);
   if(path==='/v1/stock'&&method==='POST')
     return json(await services.postStockMovement(await dataFrom(request)),201);
   if(path==='/v1/payments'&&method==='POST')
     return json(await services.receivePayment(await dataFrom(request)),201);
   const orderReceipts=path.match(/^\/v1\/orders\/([1-9]\d*)\/receipts$/);
   if(orderReceipts&&method==='GET')
     return json(await services.listReceipts(Number(orderReceipts[1])));
   const orderPayment=path.match(/^\/v1\/orders\/([1-9]\d*)\/payment$/);
   if(orderPayment&&method==='GET')
     return json(await services.getPaymentSummary(Number(orderPayment[1])));
   const reverse=path.match(/^\/v1\/orders\/([1-9]\d*)\/receipts\/([1-9]\d*)\/reverse$/);
   if(reverse&&method==='POST')
     return json(await services.reverseReceipt({
       ...await dataFrom(request),workOrderId:Number(reverse[1]),receiptId:Number(reverse[2])
     }));
   if(path==='/v1/expenses'&&method==='GET')
     return json(await services.listExpenses({
       from:u.searchParams.get('from')||undefined,to:u.searchParams.get('to')||undefined
     }));
   if(path==='/v1/expenses'&&method==='POST')
     return json(await services.createExpense(await dataFrom(request)),201);
   const expense=path.match(/^\/v1\/expenses\/([1-9]\d*)$/);
   if(expense&&method==='GET')
     return json(await services.getExpense(Number(expense[1])));
   if(expense&&method==='PATCH')
     return json(await services.updateExpense(Number(expense[1]),await dataFrom(request)));

   if(path==='/v1/reports/finance'&&method==='GET')
     return json(await services.financeSummary({
       from:u.searchParams.get('from')||undefined,to:u.searchParams.get('to')||undefined
     }));
   return json({error:'Rota interna não encontrada'},404);
  }catch(error){
   const status=[400,401,403,404,409,413,415,422].includes(error?.status)?error.status:500;
   return json({error:status===500?'Falha na operação SQL interna':error.message},status);
  }
 };
}
