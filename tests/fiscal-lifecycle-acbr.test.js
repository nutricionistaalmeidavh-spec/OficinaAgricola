import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

async function fixture(provider){
 const db=openDatabase(':memory:');
 migrate(db);migrateAssistencia(db);
 const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}),{fiscalProvider:provider});
 const customer=await ws.createCustomer({name:'Cliente fiscal'});
 const machine=await ws.createMachine({customerId:customer.id,type:'AUTOMOVEL'});
 const os=await ws.createWorkOrder({customerId:customer.id,machineId:machine.id,problemReported:'Reparo'});
 await ws.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
 await ws.saveQuote({workOrderId:os.id,items:[{kind:'PECA',description:'Filtro',quantity:1,unitPriceCents:15500}]});
 await ws.approveQuote({workOrderId:os.id});
 const doc=await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFE',requestId:'fiscal-lifecycle'});
 await ws.setFiscalSettings({issuerCnpj:'11222333000181',issuerUf:'SP',municipalityIbge:'3550308',taxRegime:'SIMPLES',enabled:true});
 return {db,ws,doc};
}
const authorized=()=>({
 status:'AUTORIZADA',environment:'HOMOLOGACAO',
 accessKey:'12345678901234567890123456789012345678901234',
 protocol:'123456789',number:'1',series:'1',
 xml:'<nfeProc><Signature>ok</Signature></nfeProc>'
});
const canceled=()=>({
 status:'CANCELADA',environment:'HOMOLOGACAO',
 accessKey:'12345678901234567890123456789012345678901234',
 protocol:'cancel-protocol-999',xml:'<procEventoNFe><retEvento>101</retEvento></procEventoNFe>'
});
test('authorized note can be canceled once with fiscal event audit, preserving XML',async()=>{
 let canceledCalls=0;
 const provider={name:'fiscal-test',
  async transmit(){return authorized();},
  async cancel({reason}){assert.match(reason,/devolu/i);canceledCalls++;return canceled();},
  async consultCancellation(){return canceled();},
  async printPdf(){return Buffer.from('%PDF-1.4\n1 0 obj\nendobj\n%%EOF')}
 };
 const {db,ws,doc}=await fixture(provider);
 try {
  await ws.submitFiscalDocument(doc.id);
  const pdf=await ws.getFiscalPdf(doc.id);
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const after=await ws.cancelFiscalDocument(doc.id,{reason:'Devolução dos produtos ao cliente'});
  assert.equal(after.status,'CANCELADA');
  assert.equal(after.authorized_xml,authorized().xml);
  assert.equal(canceledCalls,1);
  assert.equal((await ws.getFiscalEvents(doc.id)).filter(e=>e.event_type==='CANCELADA').length,1);
  await assert.rejects(ws.cancelFiscalDocument(doc.id,{reason:'Novo motivo registrado'}),/cancel|autorizad/i);
  await assert.rejects(ws.getFiscalPdf(doc.id),/cancelad|autorizad/i);
 } finally {db.close();}
});
test('uncertain cancellation is reconciled, never reissued',async()=>{
 let count=0;
 const provider={name:'fiscal-test',
  async transmit(){return authorized();},
  async cancel(){count++;throw Error('Timeout sem resposta');},
  async consultCancellation(){return canceled();}
 };
 const {db,ws,doc}=await fixture(provider);
 try{
  await ws.submitFiscalDocument(doc.id);
  await assert.rejects(ws.cancelFiscalDocument(doc.id,{reason:'Devolução dos produtos ao cliente'}),/Timeout/);
  assert.equal((await ws.getFiscalDocument(doc.id)).status,'INDETERMINADO');
  await assert.rejects(ws.cancelFiscalDocument(doc.id,{reason:'Devolução dos produtos ao cliente'}),/cancel|indeterminado/i);
  assert.equal(count,1);
  const reconciled=await ws.reconcileFiscalDocument(doc.id);
  assert.equal(reconciled.status,'CANCELADA');
  assert.equal(count,1);
 }finally{db.close();}
});
test('PDF and cancellation fail closed without provider or authorization',async()=>{
 const {db,ws,doc}=await fixture({name:'no-cancel',async transmit(){return authorized();}});
 try{
  await assert.rejects(ws.getFiscalPdf(doc.id),/autorizad/i);
  await ws.submitFiscalDocument(doc.id);
  await assert.rejects(ws.cancelFiscalDocument(doc.id,{reason:'curto'}),/justificativa|caracteres/i);
  await assert.rejects(ws.cancelFiscalDocument(doc.id,{reason:'Devolução dos produtos ao cliente'}),/cancelamento|emissor|disponível/i);
  await assert.rejects(ws.getFiscalPdf(doc.id),/PDF|emissor|disponível/i);
 }finally{db.close();}
});

test('official SEFAZ cStat 101 receipt without event XML confirms cancellation',async()=>{
 const provider={name:'acbr-test',
  async transmit(){return authorized();},
  async cancel(){return {status:'CANCELADA',environment:'HOMOLOGACAO',
   accessKey:authorized().accessKey,protocol:'cancel-protocol-123',xml:'',
   officialReceipt:{cStat:101,accessKey:authorized().accessKey,
    protocol:'cancel-protocol-123',receivedAt:'2026-11-04T13:10:00-03:00',
    environment:'HOMOLOGACAO'}};},
  async consultCancellation(){throw Error('Não deveria consultar após sucesso');}
 };
 const {db,ws,doc}=await fixture(provider);
 try{
  await ws.submitFiscalDocument(doc.id);
  const canceled=await ws.cancelFiscalDocument(doc.id,{reason:'Nota emitida com valores incorretos'});
  assert.equal(canceled.status,'CANCELADA');
  const receipt=JSON.parse(canceled.response_json);
  assert.equal(receipt.officialReceipt.cStat,101);
  assert.equal(receipt.cancellationProtocol,'cancel-protocol-123');
  assert.equal(canceled.authorized_xml,authorized().xml);
 }finally{db.close();}
});
test('unmatched SEFAZ cancellation receipt fails closed',async()=>{
 const provider={name:'acbr-test',
  async transmit(){return authorized();},
  async cancel(){return {status:'CANCELADA',environment:'HOMOLOGACAO',
   accessKey:authorized().accessKey,protocol:'receipt-01',xml:'',
   officialReceipt:{cStat:101,accessKey:'DIFFERENT',
    protocol:'receipt-01',receivedAt:'2026-11-04T13:10:00-03:00',
    environment:'HOMOLOGACAO'}};},
  async consultCancellation(){return {status:'INDETERMINADO'};}
 };
 const {db,ws,doc}=await fixture(provider);
 try{
  await ws.submitFiscalDocument(doc.id);
  await assert.rejects(ws.cancelFiscalDocument(doc.id,{reason:'Nota emitida com valores incorretos'}),/comprovante/i);
  assert.equal((await ws.getFiscalDocument(doc.id)).status,'INDETERMINADO');
 }finally{db.close();}
});
