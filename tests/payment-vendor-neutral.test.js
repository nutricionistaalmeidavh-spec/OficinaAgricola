import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createBillingService} from '../src/platform/billing-p3-p4.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
function walk(dirname){
 return readdirSync(dirname).flatMap(entry=>{
  const full=join(dirname,entry);
  return statSync(full).isDirectory()?walk(full):[full];
 });
}

test('P3/P4 não contém integração embutida com provedor removido',()=>{
 assert.equal(existsSync(join(root,'src/platform/asaas-billing.js')),false);
 assert.equal(existsSync(join(root,'src/platform/asaas-tenant-options.js')),false);
 for(const file of [...walk(join(root,'src')), ...walk(join(root,'public')),
     join(root,'docs/PAGAMENTOS-P3-P4.md')]){
  if(!/\.(?:js|mjs|md)$/.test(file))continue;
  assert.doesNotMatch(readFileSync(file,'utf8'),/asaas|TENANCY_ASAAS/i,file);
 }
});

test('parcelamento self-hosted não habilita boleto e link sem provedor explícito',()=>{
 const port={engine:'sqlite',first:async()=>null,all:async()=>[],run:async()=>({changes:1}),
  transaction:async fn=>fn(port)};
 const finance=createBillingService(port,{receivePayment:async()=>({id:1}),
  getPaymentSummary:async()=>({pendingCents:10000})});
 assert.equal(finance.capabilities().manual,true);
 assert.equal(finance.capabilities().boleto,false);
 assert.equal(finance.capabilities().paymentLink,false);
 assert.equal(finance.capabilities().externalRefunds,false);
});
