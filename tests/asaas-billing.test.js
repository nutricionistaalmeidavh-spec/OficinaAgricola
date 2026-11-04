import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsaasBillingProvider,createAsaasHttpTransport} from '../src/platform/asaas-billing.js';

test('Asaas gera boleto e fatura individual com valor, referência e cliente servidor',async()=>{
 const requests=[];
 const transport=async(method,path,body)=>{
  requests.push({method,path,body});
  if(method==='GET'&&path.startsWith('/payments?'))return {data:[]};
  if(method==='POST')return {id:'pay_123',externalReference:body.externalReference,
    customer:body.customer,billingType:body.billingType,value:body.value,
    invoiceUrl:'https://sandbox.asaas.com/i/teste',status:'PENDING'};
  return {id:'pay_123',externalReference:'billing-plan-1',customer:'cus_123',
   billingType:'BOLETO',value:25.00,status:'RECEIVED'};
 };
 const resolveCustomer=async()=> 'cus_123';
 const boleto=createAsaasBillingProvider({transport,resolveCustomer,method:'BOLETO'});
 const created=await boleto.create({requestId:'billing-plan-1',amountCents:2500,dueDate:'2026-12-10',workOrderId:1});
 assert.equal(created.reference,'pay_123');
 assert.equal(requests[1].body.billingType,'BOLETO');
 assert.equal(requests[1].body.customer,'cus_123');
 assert.equal(requests[1].body.value,25);
 assert.deepEqual(await boleto.status('pay_123',{requestId:'billing-plan-1',workOrderId:1}),
  {reference:'pay_123',status:'PAID',amountCents:2500});
 const link=createAsaasBillingProvider({transport,resolveCustomer,method:'PAYMENT_LINK'});
 await link.create({requestId:'billing-plan-2',amountCents:2600,dueDate:'2026-12-10',workOrderId:1});
 assert.equal(requests[4].body.billingType,'UNDEFINED');
});
test('Asaas nunca confunde CONFIRMED com repasse recebido nem valores incorretos',async()=>{
 const provider=createAsaasBillingProvider({method:'BOLETO',resolveCustomer:async()=> 'cus_123',
  transport:async(method,path,body)=> method==='GET'&&path.startsWith('/payments?')?{data:[]}:method==='POST'
   ?{id:'pay_1',externalReference:body.externalReference,customer:'cus_123',billingType:'BOLETO',
     value:11,invoiceUrl:'https://www.asaas.com/i/1'}
   :{id:'pay_1',externalReference:'ref-1',customer:'cus_123',billingType:'BOLETO',value:11,status:'CONFIRMED'}});
 await provider.create({requestId:'ref-1',amountCents:1100,workOrderId:1,dueDate:'2026-12-10'});
 assert.equal((await provider.status('pay_1',{requestId:'ref-1',workOrderId:1})).status,'PENDING');
 await assert.rejects(createAsaasBillingProvider({method:'BOLETO',resolveCustomer:async()=> 'cus_123',
  transport:async()=>({id:'pay_1',externalReference:'ref',customer:'cus_123',billingType:'BOLETO',
   value:50,invoiceUrl:'https://www.asaas.com/i/1'})})
  .create({requestId:'ref',amountCents:1100,workOrderId:1,dueDate:'2026-12-10'}),/valor divergente/i);
});
test('transport Asaas é HTTPS fixo, sandbox padrão e chave privada apenas em header',async()=>{
 const calls=[],apiKey='abc-secret-api-test';
 const transport=createAsaasHttpTransport({apiKey,fetchImpl:async(url,options)=>{
  calls.push({url:String(url),options});
  return {ok:true,text:async()=>JSON.stringify({id:'pay_1'})};
 }});
 assert.deepEqual(await transport('GET','/payments/pay_1'),{id:'pay_1'});
 assert.equal(calls[0].url,'https://api-sandbox.asaas.com/v3/payments/pay_1');
 assert.equal(calls[0].options.headers.access_token,apiKey);
 assert.equal(calls[0].options.headers['User-Agent'],'ArtiSys-Oficina/1.0');
 await assert.rejects(transport('GET','https://evil.test/'),/caminho/i);
 assert.throws(()=>createAsaasHttpTransport({apiKey,environment:'production'}),/produção/i);
});
