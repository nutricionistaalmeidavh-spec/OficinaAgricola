import test from 'node:test';
import assert from 'node:assert/strict';
import {createBacenPixProvider,createLoopbackPaymentProvider} from '../src/platform/payment-providers.js';

test('API Pix BACEN usa PUT idempotente, valida QR e liquidação em centavos',async()=>{
 let txid=null,paid=false;
 const transport=async(method,path,body)=>{
  if(method==='PUT'){
   txid=path.split('/').at(-1);
   assert.match(txid,/^[A-Z0-9]{32}$/);
   assert.equal(body.valor.original,'25.00');
   return {txid,chave:'pix@example.com',valor:{original:'25.00'},pixCopiaECola:'000201SIMULADO'};
  }
  assert.equal(method,'GET');
  assert.equal(path,'/cob/'+txid);
  return {txid,chave:'pix@example.com',status:paid?'CONCLUIDA':'ATIVA',
   valor:{original:'25.00'},pix:paid?[{valor:'25.00'}]:[]};
 };
 const provider=createBacenPixProvider({pixKey:'pix@example.com',transport});
 const a=await provider.create({requestId:'chave-001',amountCents:2500});
 const b=await provider.create({requestId:'chave-001',amountCents:2500});
 assert.equal(a.reference,b.reference);
 assert.equal((await provider.status(a.reference)).status,'PENDING');
 paid=true;
 assert.deepEqual(await provider.status(a.reference),{reference:a.reference,status:'PAID',amountCents:2500});
});
test('API Pix BACEN não aceita status CONCLUIDA sem registro de Pix liquidado',async()=>{
 const provider=createBacenPixProvider({pixKey:'pix@example.com',transport:async(method,path,body)=>{
  const txid=path.split('/').at(-1);
  return method==='PUT'
   ?{txid,chave:'pix@example.com',valor:{original:'10.00'},pixCopiaECola:'QR'}
   :{txid,chave:'pix@example.com',valor:{original:'10.00'},status:'CONCLUIDA',pix:[]};
 }});
 const a=await provider.create({requestId:'sem-comprovante',amountCents:1000});
 await assert.rejects(provider.status(a.reference),/não verificada/);
});
test('ponte TEF restringe destino a loopback e retorna apenas resultados validados',async()=>{
 const token='x'.repeat(36);
 assert.throws(()=>createLoopbackPaymentProvider({endpoint:'http://192.168.0.55:8080/',token}),/loopback/);
 assert.throws(()=>createLoopbackPaymentProvider({endpoint:'https://example.com/',token}),/loopback/);
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url:String(url),options});
  return {ok:true,text:async()=>JSON.stringify(url.pathname.endsWith('create')
   ?{reference:'terminal-id-1'}:{reference:'terminal-id-1',status:'PAID',amountCents:500})};
 };
 const p=createLoopbackPaymentProvider({endpoint:'http://127.0.0.1:3333/',token,fetchImpl});
 assert.equal((await p.create({requestId:'r1',amountCents:500,workOrderId:1})).reference,'terminal-id-1');
 assert.equal((await p.status('terminal-id-1')).status,'PAID');
 assert.equal(calls.length,2);
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
});
