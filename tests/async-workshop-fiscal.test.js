import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

async function ready(db,provider){
 migrate(db);migrateAssistencia(db);
 const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}),{fiscalProvider:provider});
 const customer=await ws.createCustomer({name:'Comprador'});
 const vehicle=await ws.createMachine({customerId:customer.id,type:'AUTOMOVEL'});
 const os=await ws.createWorkOrder({customerId:customer.id,machineId:vehicle.id,problemReported:'Peça'});
 await ws.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
 await ws.saveQuote({workOrderId:os.id,items:[{kind:'PECA',description:'Filtro',quantity:1,unitPriceCents:500}]});
 await ws.approveQuote({workOrderId:os.id});
 const draft=await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFE',requestId:'shared-fiscal-001'});
 return {ws,draft,os};
}
test('shared fiscal adapter rejects disabled issuance and production without explicit approval',async()=>{
 const db=openDatabase(':memory:');
 try{
  const {ws,draft}=await ready(db,{name:'fake',async transmit(){throw Error('Must not transmit');}});
  assert.equal((await ws.getFiscalSettings()).enabled,0);
  await assert.rejects(ws.submitFiscalDocument(draft.id),/Fiscal desabilitado/);
  await assert.rejects(ws.setFiscalSettings({
   issuerCnpj:'11222333000181',issuerUf:'SP',municipalityIbge:'3550308',
   taxRegime:'SIMPLES',enabled:true,environment:'PRODUCAO'
  }),/confirmação/);
  assert.equal((await ws.getFiscalSettings()).enabled,0);
 }finally{db.close();}
});
test('shared fiscal adapter authorizes exactly one sidecar submission with frozen issuer and receipt',async()=>{
 const db=openDatabase(':memory:');
 let sent=0,prepared=0;
 try{
  const provider={name:'sidecar-test',
   prepare({document,issuer}){assert.ok(document.id);assert.equal(issuer.cnpj,'11222333000181');prepared++;},
   async transmit({document,attemptId}){sent++;assert.ok(attemptId);assert.equal(document.status,'INDETERMINADO');
    return {status:'AUTORIZADA',environment:'HOMOLOGACAO',
      accessKey:'12345678901234567890123456789012345678901234',
      protocol:'123456789',number:'8',series:'1',xml:'<nfe>QA</nfe>'};
   }
  };
  const {ws,draft}=await ready(db,provider);
  await ws.setFiscalSettings({issuerCnpj:'11222333000181',issuerUf:'SP',
   municipalityIbge:'3550308',taxRegime:'SIMPLES',enabled:true});
  const issued=await ws.submitFiscalDocument(draft.id);
  assert.equal(issued.status,'AUTORIZADA_HOMOLOGACAO');
  assert.equal(issued.fiscal_number,'8');
  assert.equal(sent,1);assert.equal(prepared,1);
  assert.equal((await ws.getFiscalEvents(draft.id)).filter(x=>x.event_type==='TRANSMISSAO_INICIADA').length,1);
  await assert.rejects(ws.submitFiscalDocument(draft.id),/não permite nova transmissão/);
  assert.equal(sent,1);
 }finally{db.close();}
});

test('produção recusa transmissão sem homologação ACBr vinculada, mesmo com confirmação administrativa',async()=>{
 const db=openDatabase(':memory:');
 let sent=0;
 try{
  const provider={name:'acbrlib-local',
   certificateStatus:()=>({configured:true,certificateType:'A1'}),
   certificateIdentity:()=> 'a'.repeat(64),
   async transmit(){sent++;throw Error('Transmissão sem gate fiscal');}};
  const {ws,draft}=await ready(db,provider);
  await ws.setFiscalSettings({issuerCnpj:'11222333000181',issuerUf:'SP',
   municipalityIbge:'3550308',taxRegime:'SIMPLES',enabled:true,
   environment:'PRODUCAO',productionConfirmed:true});
  // O rascunho anterior é do ambiente de homologação; testamos também
  // o gate explicitamente com rascunho de produção, sem afetar sua origem.
  await assert.rejects(ws.submitFiscalDocument(draft.id),/outro ambiente/);
  await db.prepare('UPDATE fiscal_documents SET environment=? WHERE id=?').run('PRODUCAO',draft.id);
  await assert.rejects(ws.submitFiscalDocument(draft.id),/produção não liberada/i);
  assert.equal(sent,0);
  assert.equal((await ws.getFiscalDocument(draft.id)).status,'RASCUNHO');
 }finally{db.close();}
});
