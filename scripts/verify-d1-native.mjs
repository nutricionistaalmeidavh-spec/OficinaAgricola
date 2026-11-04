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
console.log('Wrangler local D1 real: native schema, quote, fiscal draft, stock, payment, finance OK');
