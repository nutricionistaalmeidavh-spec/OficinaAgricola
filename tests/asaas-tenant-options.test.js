import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTenantAsaasConfigs,createTenantAsaasBillingProviders} from '../src/platform/asaas-tenant-options.js';
test('Asaas só habilita para unidade configurada e resolve cliente da própria OS',async()=>{
 const config=validateTenantAsaasConfigs({
  '1/2':{environment:'sandbox',apiKey:'test-key-abcdefgh',
   customers:{'12':'cus_ABC123'}}
 });
 const rows={45:{customer_id:12}};
 const port={first:async(sql,params)=>rows[params[0]]??null};
 const options=createTenantAsaasBillingProviders({id:2,companyId:1},config,port);
 assert.ok(options.BOLETO);
 assert.ok(options.PAYMENT_LINK);
 assert.deepEqual(createTenantAsaasBillingProviders({id:1,companyId:1},config,port),{});
 await assert.rejects(options.BOLETO.create({requestId:'ab-1',workOrderId:46,amountCents:500,dueDate:'2026-12-01'}),/cliente.*vinculado/i);
});
test('configuração exige confirmação explícita para produção e rejeita outras empresas',()=>{
 assert.throws(()=>validateTenantAsaasConfigs({'2/1':{environment:'production',apiKey:'test-key-abcdefgh',
   customers:{}}}),/produção/i);
 assert.throws(()=>validateTenantAsaasConfigs({'2/1':{environment:'sandbox',apiKey:'test-key-abcdefgh',
   customers:{}},'2/2':{environment:'sandbox',apiKey:'test-key-abcdefgh',customers:{}}}),/duplicada/i);
});
