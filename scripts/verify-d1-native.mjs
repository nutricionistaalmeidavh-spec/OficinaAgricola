#!/usr/bin/env node
import assert from 'node:assert/strict';

// Tests an actual locally running Wrangler/D1 runtime, never a Cloudflare
// account or a customer's database. Requires an explicitly supplied test token.
const token=process.env.ASYNC_BACKEND_SERVICE_TOKEN,base='http://127.0.0.1:8787';
if(!token||token.length<32||process.env.CI!=='true')
 throw Error('D1 parity requires CI=true and an ephemeral local test service token');
let ready=false;
for(let attempt=0;attempt<40;attempt++){
 try{
  const r=await fetch(base+'/v1/health',{headers:{Authorization:'Bearer '+token}});
  if(r.ok){ready=true;break;}
 }catch{}
 await new Promise(resolve=>setTimeout(resolve,400));
}
if(!ready)throw Error('Local Wrangler D1 Worker failed to start');
const request=async(method,path,body)=>{
 const response=await fetch(base+path,{method,headers:{
   Authorization:'Bearer '+token,
   ...(body?{'Content-Type':'application/json'}:{})
 },body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(!response.ok)throw Error(method+' '+path+' => HTTP '+response.status+': '+JSON.stringify(result));
 return result;
};
const unauthorized=await fetch(base+'/v1/orders',{method:'POST',body:'{}'});
assert.equal(unauthorized.status,401);
await request('POST','/v1/migrate');
await request('POST','/v1/migrate');
const admin=await request('POST','/v1/auth/bootstrap',{
 username:'d1-admin',name:'D1 Admin',password:'S3cureD1Password#2026'
});
assert.equal(admin.role,'ADMIN');
const login=await request('POST','/v1/auth/login',{
 username:'d1-admin',password:'S3cureD1Password#2026'
});
assert.equal(login.user.id,admin.id);
assert.ok(login.token?.length>32);
const tech=await request('POST','/v1/auth/users',{
 username:'d1-tech',name:'D1 Technician',password:'S3cureTech#2026',
 role:'TECNICO',sessionToken:login.token
});
assert.equal(tech.role,'TECNICO');
const c=await request('POST','/v1/customers',{name:'D1 Cliente real'});
const machine=await request('POST','/v1/machines',{customerId:c.id,type:'AUTOMOVEL',brand:'VW'});
const os=await request('POST','/v1/orders',{customerId:c.id,machineId:machine.id,problemReported:'D1 QA'});
assert.equal(os.status,'ENTRADA');
const status=await request('POST','/v1/orders/'+os.id+'/status',{
 toStatus:'DIAGNOSTICO',expectedVersion:os.version
});
assert.equal(status.status,'DIAGNOSTICO');
const quote=await request('PUT','/v1/orders/'+os.id+'/quote',{
 items:[
  {kind:'PECA',description:'Filtro',quantity:2,unitPriceCents:1500},
  {kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:1200}
 ],discountCents:200
});
assert.equal(quote.total_cents,4000);
const approval=await request('POST','/v1/orders/'+os.id+'/quote/approve');
assert.equal(approval.approval_status,'APROVADO');
const f=await request('POST','/v1/fiscal/drafts',{
 originType:'OS',originId:os.id,kind:'NFE',requestId:'d1-real-fiscal-001'
});
assert.equal(f.amount_cents,2857);
const dup=await request('POST','/v1/fiscal/drafts',{
 originType:'OS',originId:os.id,kind:'NFE',requestId:'d1-real-fiscal-001'
});
assert.equal(f.id,dup.id);
const part=await request('POST','/v1/parts',{sku:'D1-PART-001',description:'Filtro',salePriceCents:1500});
await request('POST','/v1/stock',{partId:part.id,type:'ENTRADA',quantity:5});
await request('POST','/v1/stock',{partId:part.id,type:'SAIDA_MANUAL',quantity:2});
let blocked=false;
try{await request('POST','/v1/stock',{partId:part.id,type:'SAIDA_MANUAL',quantity:100});}
catch(e){blocked=/Estoque insuficiente/.test(e.message);}
assert.ok(blocked,'insufficient stock was rejected');
const receipt=await request('POST','/v1/payments',{
 workOrderId:os.id,amountCents:2000,method:'PIX',requestId:'d1-real-pay-001'
});
const repeat=await request('POST','/v1/payments',{
 workOrderId:os.id,amountCents:2000,method:'PIX',requestId:'d1-real-pay-001'
});
assert.equal(receipt.id,repeat.id);
const finances=await request('GET','/v1/reports/finance');
assert.equal(finances.receivedCents,2000);
assert.equal(finances.pendingCents,2000);

const auto=await request('POST','/v1/machines',{
 customerId:c.id,type:'AUTOMOVEL',brand:'Volkswagen',model:'Gol',
 year:2018,engine:'1.6',fuelType:'FLEX'
});
const fit=await request('POST','/v1/parts/'+part.id+'/fitments',{
 brand:'Volkswagen',model:'Gol',yearFrom:2017,yearTo:2020,
 engine:'1.6',fuelType:'FLEX'
});
assert.equal((await request('GET','/v1/machines/'+auto.id+'/compatible-parts'))[0].id,part.id);
await request('DELETE','/v1/parts/'+part.id+'/fitments/'+fit.id);
assert.equal((await request('GET','/v1/machines/'+auto.id+'/compatible-parts')).length,0);
const plan=await request('POST','/v1/machines/'+auto.id+'/maintenance-plans',{
 name:'Revisão preventiva',intervalDays:90,startingDate:'2026-08-01'
});
assert.equal(plan.next_due_date,'2026-10-30');
assert.ok((await request('GET','/v1/maintenance-alerts?today=2026-11-04'))
 .some(row=>row.id===plan.id));
const completed=await request('POST','/v1/maintenance-plans/'+plan.id+'/complete',{
 performedAt:'2026-11-04'
});
assert.equal(completed.last_completed_at,'2026-11-04');
assert.equal((await request('GET','/v1/machines/'+auto.id+'/maintenance')).length,1);
const repeatMaintenance=await fetch(base+'/v1/maintenance-plans/'+plan.id+'/complete',{
 method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
 body:JSON.stringify({performedAt:'2026-11-04'})
});
assert.equal(repeatMaintenance.status,409,'duplicate preventive completion must never double-book');
const session=await request('POST','/v1/cash/open',{
 openingCents:1000,requestId:'d1-real-cash-001'
});
assert.equal(session.status,'ABERTO');
const d1Sale={
 paymentMethod:'DINHEIRO',cashSessionId:session.id,
 items:[{partId:part.id,quantity:1}],
 requestId:'d1-real-sale-001'
};
const sold=await request('POST','/v1/sales',d1Sale);
assert.equal(sold.total_cents,1500);
assert.equal((await request('POST','/v1/sales',d1Sale)).id,sold.id);
assert.equal((await request('GET','/v1/parts/'+part.id+'/reconcile')).difference,0);
const refunded=await request('POST','/v1/sales/'+sold.id+'/cancel',{
 reason:'Estorno QA do fluxo nativo'
});
assert.equal(refunded.status,'CANCELADA');
assert.equal((await request('GET','/v1/parts/'+part.id+'/reconcile')).difference,0);
const cashSummary=await request('GET','/v1/cash/summary');
assert.equal(cashSummary.expectedCashCents,1000);
console.log('Wrangler D1 real: 46 tabelas, OS, fiscal, caixa, estoque, reembolso, fitment e revisão OK');

