// Explicit reviewed legacy-to-native API allowlist. No generic path rewriting.
const ALL=Object.freeze(['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO']);
const OFFICE=Object.freeze(['ADMIN','ATENDIMENTO']);
const TECH=Object.freeze(['ADMIN','ATENDIMENTO','TECNICO']);
const FIN=Object.freeze(['ADMIN','FINANCEIRO']);
const SALES=Object.freeze(['ADMIN','ATENDIMENTO','FINANCEIRO']);
const ADMIN=Object.freeze(['ADMIN']);
const ROLES={ALL,OFFICE,TECH,FIN,ADMIN,SALES};
const ROUTES=[
 'GET /api/dashboard /v1/dashboard ALL',
 'GET /api/reports /v1/reports/operations ALL',
 'GET /api/company /v1/company ALL',
 'PATCH /api/company /v1/company ADMIN',
 'GET /api/customers/page /v1/customers/page ALL',
 'GET /api/customers/:id /v1/customers/:id ALL',
 'GET /api/machines/page /v1/machines/page ALL',
 'GET /api/machines/:id /v1/machines/:id ALL',
 'GET /api/machines/:id/history /v1/machines/:id/history ALL',
 'GET /api/cash/current /v1/cash/current SALES',
 'GET /api/cash/sessions /v1/cash/sessions SALES',
 'GET /api/schedule/page /v1/schedule/page ALL',
 'GET /api/expenses/page /v1/expenses/page FIN',
 'GET /api/fiscal/page /v1/fiscal/page FIN',
 'GET /api/sales/page /v1/sales/page SALES',
 'GET /api/fiscal/:id/xml /v1/fiscal/:id/xml FIN',
 'GET /api/fiscal/:id/pdf /v1/fiscal/:id/pdf FIN',
 'PATCH /api/technicians/:id /v1/technicians/:id ADMIN',
 'GET /api/customers /v1/customers ALL',
 'POST /api/customers /v1/customers OFFICE',
 'PATCH /api/customers/:id /v1/customers/:id OFFICE',
 'GET /api/machines /v1/machines ALL',
 'POST /api/machines /v1/machines OFFICE',
 'PATCH /api/machines/:id /v1/machines/:id OFFICE',
 'GET /api/technicians /v1/technicians ALL',
 'POST /api/technicians /v1/technicians ADMIN',
 'GET /api/work-orders /v1/orders ALL',
 'GET /api/work-orders/page /v1/orders/page ALL',
 'POST /api/work-orders /v1/orders OFFICE orderCreate',
 'GET /api/work-orders/:id /v1/orders/:id ALL',
 'PATCH /api/work-orders/:id /v1/orders/:id TECH',
 'POST /api/work-orders/:id/duplicate /v1/orders/:id/duplicate OFFICE',
 'POST /api/work-orders/:id/status /v1/orders/:id/status TECH status',
 'GET /api/work-orders/:id/history /v1/orders/:id/history ALL',
 'GET /api/work-orders/:id/quote /v1/orders/:id/quote ALL',
 'PUT /api/work-orders/:id/quote /v1/orders/:id/quote OFFICE',
 'POST /api/work-orders/:id/quote/submit /v1/orders/:id/quote/submit OFFICE',
 'POST /api/work-orders/:id/quote/approve /v1/orders/:id/quote/approve OFFICE',
 'POST /api/work-orders/:id/quote/reject /v1/orders/:id/quote/reject OFFICE',
 'POST /api/work-orders/:id/quote/approval-link /v1/orders/:id/quote/approval-link OFFICE',
 'GET /api/parts /v1/parts ALL',
 'POST /api/parts /v1/parts OFFICE',
 'GET /api/parts/page /v1/parts/page ALL',
 'GET /api/parts/:id /v1/parts/:id ALL',
 'PATCH /api/parts/:id /v1/parts/:id OFFICE',
 'GET /api/parts/:id/fitments /v1/parts/:id/fitments ALL',
 'POST /api/parts/:id/fitments /v1/parts/:id/fitments OFFICE',
 'DELETE /api/parts/:id/fitments/:fitmentId /v1/parts/:id/fitments/:fitmentId OFFICE',
 'POST /api/inventory/movements /v1/stock OFFICE',
 'GET /api/inventory/low-stock /v1/parts/low-stock ALL',
 'GET /api/work-orders/:id/parts /v1/orders/:id/parts ALL',
 'POST /api/work-orders/:id/parts /v1/orders/:id/parts TECH order',
 'POST /api/work-orders/:id/parts/:itemId/reverse /v1/orders/:id/parts/:itemId/reverse TECH reversePart',
 'GET /api/schedule /v1/schedule ALL',
 'POST /api/schedule /v1/schedule TECH',
 'PATCH /api/schedule/:id /v1/schedule/:id TECH',
 'GET /api/checklist-templates /v1/checklist-templates ALL',
 'POST /api/checklist-templates /v1/checklist-templates ADMIN',
 'GET /api/checklist-templates/:id /v1/checklist-templates/:id ALL',
 'GET /api/work-orders/:id/checklists /v1/orders/:id/checklists ALL',
 'POST /api/work-orders/:id/checklists /v1/orders/:id/checklists TECH order',
 'GET /api/work-orders/:id/attachments /v1/orders/:id/attachments ALL',
 'POST /api/work-orders/:id/attachments /v1/orders/:id/attachments TECH',
 'GET /api/attachments/:id/file /v1/attachments/:id/file ALL',
 'GET /api/billing/capabilities /v1/billing/capabilities FIN',
 'POST /api/billing/plans /v1/billing/plans FIN',
 'GET /api/billing/orders/:id/plan /v1/billing/orders/:id/plan FIN',
 'GET /api/billing/plans/:planId /v1/billing/plans/:planId FIN',
 'POST /api/billing/installments/:installmentId/activate /v1/billing/installments/:installmentId/activate FIN',
 'POST /api/billing/installments/:installmentId/sync /v1/billing/installments/:installmentId/sync FIN',
 'POST /api/billing/installments/:installmentId/manual /v1/billing/installments/:installmentId/manual FIN',
 'POST /api/billing/settlements /v1/billing/settlements FIN',
 'GET /api/billing/report /v1/billing/report FIN',
 'GET /api/billing/statements /v1/billing/statements FIN',
 'GET /api/billing/receipts/available /v1/billing/receipts/available FIN',
 'POST /api/billing/statements /v1/billing/statements FIN',
 'POST /api/billing/statements/:entryId/match /v1/billing/statements/:entryId/match FIN',
 'POST /api/billing/reminders/prepare /v1/billing/reminders/prepare FIN',
 'POST /api/billing/reminders/run /v1/billing/reminders/run FIN',
 'GET /api/billing/reminders /v1/billing/reminders FIN',
 'POST /api/billing/statements/import /v1/billing/statements/import FIN',
 'POST /api/billing/installments/:installmentId/refund /v1/billing/installments/:installmentId/refund FIN',
 'GET /api/billing/refunds/:refundId /v1/billing/refunds/:refundId FIN',
 'POST /api/billing/refunds/:refundId/sync /v1/billing/refunds/:refundId/sync FIN',
 'GET /api/payment-intents/capabilities /v1/payment-intents/capabilities FIN',
 'POST /api/payment-intents /v1/payment-intents FIN',
 'GET /api/payment-intents/:intentId /v1/payment-intents/:intentId FIN',
 'POST /api/payment-intents/:intentId/sync /v1/payment-intents/:intentId/sync FIN',
 'GET /api/work-orders/:id/payment /v1/orders/:id/payment ALL',
 'GET /api/work-orders/:id/receipts /v1/orders/:id/receipts ALL',
 'POST /api/work-orders/:id/receipts /v1/payments FIN receipt',
 'POST /api/work-orders/:id/receipts/:receiptId/reverse /v1/orders/:id/receipts/:receiptId/reverse FIN reverseReceipt',
 'GET /api/expenses /v1/expenses FIN',
 'POST /api/expenses /v1/expenses FIN',
 'PATCH /api/expenses/:id /v1/expenses/:id FIN',
 'GET /api/finance/summary /v1/reports/finance FIN',
 'GET /api/fiscal /v1/fiscal FIN',
 'GET /api/fiscal/onboarding /v1/fiscal/onboarding ADMIN',
 'POST /api/fiscal/certificate /v1/fiscal/certificate ADMIN',
 'GET /api/fiscal/certificates /v1/fiscal/certificates ADMIN',
 'POST /api/fiscal/certificate/a3 /v1/fiscal/certificate/a3 ADMIN',
 'POST /api/fiscal/diagnose /v1/fiscal/diagnose ADMIN',
 'GET /api/fiscal/tax/profiles /v1/fiscal/tax/profiles FIN',
 'POST /api/fiscal/tax/profiles /v1/fiscal/tax/profiles ADMIN',
 'GET /api/fiscal/:id/tax-review /v1/fiscal/:id/tax-review FIN',
 'POST /api/fiscal/:id/tax-review /v1/fiscal/:id/tax-review FIN',
 'GET /api/fiscal/settings /v1/fiscal/settings FIN',
 'PATCH /api/fiscal/settings /v1/fiscal/settings ADMIN',
 'POST /api/fiscal/nfse/route /v1/fiscal/nfse/route FIN',
 'POST /api/fiscal/:id/nfse/competence /v1/fiscal/:id/nfse/competence FIN',
 'GET /api/fiscal/:id/nfse/dps /v1/fiscal/:id/nfse/dps ADMIN',
 'POST /api/fiscal/:id/nfse/dps /v1/fiscal/:id/nfse/dps ADMIN',
 'POST /api/fiscal/drafts /v1/fiscal/drafts FIN',
 'GET /api/fiscal/:id /v1/fiscal/:id FIN',
 'GET /api/fiscal/:id/events /v1/fiscal/:id/events FIN',
 'POST /api/fiscal/:id/submit /v1/fiscal/:id/submit FIN',
 'POST /api/fiscal/:id/reconcile /v1/fiscal/:id/reconcile FIN',
 'POST /api/fiscal/:id/cancel /v1/fiscal/:id/cancel ADMIN',
 'GET /api/services /v1/services ALL',
 'POST /api/services /v1/services OFFICE',
 'GET /api/sales /v1/sales SALES',
 'POST /api/sales /v1/sales SALES',
 'GET /api/sales/:id /v1/sales/:id SALES',
 'POST /api/sales/:id/cancel /v1/sales/:id/cancel FIN sale',
 'POST /api/cash/open /v1/cash/open SALES',
 'GET /api/cash/current/summary /v1/cash/summary SALES',
 'POST /api/cash/current/close /v1/cash/close SALES',
 'GET /api/machines/:id/compatible-parts /v1/machines/:id/compatible-parts ALL',
 'GET /api/machines/:id/obd-scans /v1/machines/:id/obd-scans ALL',
 'POST /api/machines/:id/obd-scans /v1/machines/:id/obd-scans TECH',
 'GET /api/machines/:id/maintenance-plans /v1/machines/:id/maintenance-plans ALL',
 'POST /api/machines/:id/maintenance-plans /v1/machines/:id/maintenance-plans OFFICE',
 'GET /api/machines/:id/maintenance /v1/machines/:id/maintenance ALL',
 'POST /api/machines/:id/maintenance /v1/machines/:id/maintenance OFFICE',
 'POST /api/maintenance-plans/:id/complete /v1/maintenance-plans/:id/complete TECH',
 'GET /api/maintenance-alerts /v1/maintenance-alerts ALL',
 'GET /api/vehicles/plate/:plate /v1/vehicles/plate/:plate ALL',
 'GET /api/crm/tasks /v1/crm/tasks ALL',
 'POST /api/crm/tasks /v1/crm/tasks OFFICE',
 'POST /api/crm/tasks/:id/complete /v1/crm/tasks/:id/complete OFFICE',
 'POST /api/crm/maintenance/sync /v1/crm/maintenance/sync OFFICE',
 'GET /api/fleets /v1/fleets ALL',
 'POST /api/fleets /v1/fleets OFFICE',
 'POST /api/fleets/:id/vehicles /v1/fleets/:id/vehicles OFFICE',
 'GET /api/technical-references /v1/technical-references ALL',
 'POST /api/technical-references /v1/technical-references OFFICE'
];
const definitions=ROUTES.map(line=>{
 const [method,legacy,native,role,transform='identity']=line.split(' ');
 const names=[];
 const expression=new RegExp('^'+legacy.replace(/:([A-Za-z]+)/g,(_,name)=>{
  names.push(name);
  return name==='plate'?'([A-Z0-9-]{1,16})':['intentId','planId','installmentId','entryId'].includes(name)?'([a-f0-9]{32})':'([1-9][0-9]*)';
 })+'$');
 return Object.freeze({method,legacy,native,roles:ROLES[role],transform,names,expression});
});
export function mapLegacyNativeRoute(method,path){
 if(typeof method!=='string'||typeof path!=='string'||!path.startsWith('/api/')||
    path.includes('%')||path.includes('\\')||path.includes('//'))return null;
 const verb=method.toUpperCase();
 for(const spec of definitions){
  if(spec.method!==verb)continue;
  const match=spec.expression.exec(path);
  if(!match)continue;
  const values=match.slice(1);
  let target=spec.native;
  spec.names.forEach((name,index)=>{target=target.replace(':'+name,values[index]);});
  return Object.freeze({method:verb,path:target,roles:spec.roles,
   mapBody:(input={})=>{
    const body={...input};
    if(spec.transform==='orderCreate'){
      body.unitId=1;
      delete body.createdBy;
      delete body.changedBy;
    }
    if(spec.transform==='status'){
      body.toStatus=body.toStatus??body.status;delete body.status;
    }else if(spec.transform==='order'||spec.transform==='receipt'||spec.transform==='reversePart'||spec.transform==='reverseReceipt'){
      body.workOrderId=Number(values[0]);
      if(spec.transform==='reversePart')body.itemId=Number(values[1]);
      if(spec.transform==='reverseReceipt')body.receiptId=Number(values[1]);
    }else if(spec.transform==='sale')body.saleId=Number(values[0]);
    return body;
   }});
 }
 return null;
}
export const nativeRouteCoverage=Object.freeze(definitions.map(x=>x.method+' '+x.legacy));
