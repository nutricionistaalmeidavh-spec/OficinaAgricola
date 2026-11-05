import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNfseRoute,assertNfseRouteForTransmission} from '../src/platform/nfse-routing.js';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';

const caseRoute=(municipalityIbge,taxRegime,competenceDate)=>
 resolveNfseRoute({municipalityIbge,taxRegime,competenceDate});

test('regra nacional obrigatória respeita competência e regime, não data de emissão',()=>{
 for(const ibge of ['4115200','4128104','4118402','4104303','4105508','4126256','4128104']){
   const route=caseRoute(ibge,'SIMPLES','2026-11-01');
   assert.equal(route.channel,'NACIONAL');
   assert.equal(route.competenceDate,'2026-11-01');
   assert.equal(route.automatic,true);
 }
 assert.equal(caseRoute('4128104','SIMPLES','2026-10-31').channel,'MUNICIPAL');
 assert.equal(caseRoute('4128104','MEI','2026-10-31').channel,'NACIONAL');
});

test('municipios que migraram e casos incertos bloqueiam escolha sem prova',()=>{
 assert.equal(caseRoute('4105508','NORMAL','2026-01-01').channel,'NACIONAL');
 assert.equal(caseRoute('4115200','NORMAL','2026-07-01').channel,'NACIONAL');
 assert.equal(caseRoute('4115200','SIMPLES','2026-05-01').channel,'NACIONAL');
 assert.equal(caseRoute('4115200','NORMAL','2026-06-01').channel,'PENDENTE');
 assert.equal(caseRoute('4118402','NORMAL','2026-11-02').channel,'PENDENTE');
 assert.equal(caseRoute('4128104','NORMAL','2026-11-02').channel,'MUNICIPAL');
 assert.equal(caseRoute('4126256','NORMAL','2026-11-02').channel,'MUNICIPAL');
 assert.equal(caseRoute('4104303','NORMAL','2026-11-02').channel,'MUNICIPAL');
});

test('competência e município passam por validação rigorosa',()=>{
 for(const date of ['','2026-02-30','2026-2-01','2026-13-01','not-a-date'])
   assert.throws(()=>caseRoute('4115200','SIMPLES',date),/competência/i);
 assert.throws(()=>caseRoute('9999999','SIMPLES','2026-11-01'),/município|IBGE/i);
 assert.throws(()=>caseRoute('4115200','X','2026-11-01'),/regime/i);
 assert.throws(()=>assertNfseRouteForTransmission({kind:'NFSE',snapshot_json:'{}'},{
  uf:'PR',municipalityIbge:'4115200',taxRegime:'SIMPLES'
 },{nfseChannel:'NACIONAL'}),/competência|canal|snapshot/i);
});

async function setup(){
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 const calls=[];
 const provider={name:'test-provider',nfseChannel:'NACIONAL',
   async transmit(data){calls.push(data);return {status:'REJEITADA',code:'DEV',message:'simulado'};},
   async consult(){return {status:'INDETERMINADO'};}
 };
 const ws=createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}),{fiscalProvider:provider});
 const customer=await ws.createCustomer({name:'Contribuinte'});
 const machine=await ws.createMachine({customerId:customer.id,type:'AUTOMOVEL'});
 const os=await ws.createWorkOrder({customerId:customer.id,machineId:machine.id,problemReported:'Serviço'});
 await ws.transitionWorkOrder({workOrderId:os.id,toStatus:'DIAGNOSTICO',expectedVersion:os.version});
 await ws.saveQuote({workOrderId:os.id,items:[{kind:'MAO_DE_OBRA',description:'Revisão',quantity:1,unitPriceCents:9800}]});
 await ws.approveQuote({workOrderId:os.id});
 await ws.setFiscalSettings({issuerCnpj:'11222333000181',issuerUf:'PR',
  municipalityIbge:'4128104',taxRegime:'SIMPLES',enabled:true});
 return {db,ws,os,provider,calls};
}

test('servidor fixa competência e canal no snapshot canônico e preserva idempotência',async()=>{
 const {db,ws,os,calls}=await setup();
 try{
  const route=await ws.getNfseRoute({competenceDate:'2026-11-05'});
  assert.equal(route.channel,'NACIONAL');
  const draft=await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFSE',
   competenceDate:'2026-11-05',requestId:'nfse-route-1'});
  const snap=JSON.parse(draft.snapshot_json);
  assert.equal(snap.nfseRoute.channel,'NACIONAL');
  assert.equal(snap.nfseRoute.competenceDate,'2026-11-05');
  assert.equal((await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFSE',competenceDate:'2026-11-05',requestId:'nfse-route-1'})).id,draft.id);
  await assert.rejects(ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFSE',
   competenceDate:'2026-10-31',requestId:'nfse-route-1'}),/competência/i);
  await ws.setFiscalSettings({issuerCnpj:'11222333000181',issuerUf:'PR',
   municipalityIbge:'4128104',taxRegime:'NORMAL',enabled:true});
  await assert.rejects(ws.submitFiscalDocument(draft.id),/regime|cadastro|canal/i);
  assert.equal((await ws.getFiscalDocument(draft.id)).status,'RASCUNHO');
  assert.equal(calls.length,0);
 }finally{db.close();}
});

test('NFS-e não transmite em canal errado nem em município sem regra validada',async()=>{
 const {db,ws,os,provider,calls}=await setup();
 try{
  const draft=await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFSE',
   competenceDate:'2026-11-05',requestId:'nfse-route-2'});
  provider.nfseChannel='MUNICIPAL';
  await assert.rejects(ws.submitFiscalDocument(draft.id),/canal|emissor/i);
  assert.equal((await ws.getFiscalDocument(draft.id)).status,'RASCUNHO');
  assert.equal(calls.length,0);
  await ws.setFiscalSettings({issuerCnpj:'11222333000181',issuerUf:'PR',
   municipalityIbge:'4118402',taxRegime:'NORMAL',enabled:true});
  const pending=await ws.getNfseRoute({competenceDate:'2026-11-05'});
  assert.equal(pending.channel,'PENDENTE');
  await assert.rejects(ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFSE',
   competenceDate:'2026-11-05',requestId:'nfse-route-3'}),/regra municipal|pendente/i);
 }finally{db.close();}
});

test('rascunho NFS-e permite corrigir competência sem transmissões e preserva auditoria',async()=>{
 const {db,ws,os,calls}=await setup();
 try{
   const draft=await ws.createFiscalDraft({originType:'OS',originId:os.id,kind:'NFSE',
     competenceDate:'2026-11-05',requestId:'nfse-revise-1'});
   const corrected=await ws.reviseNfseDraftRoute(draft.id,{competenceDate:'2026-10-31'});
   assert.equal(corrected.status,'RASCUNHO');
   assert.notEqual(corrected.snapshot_hash,draft.snapshot_hash);
   assert.equal(JSON.parse(corrected.snapshot_json).nfseRoute.channel,'MUNICIPAL');
   assert.equal(JSON.parse(corrected.snapshot_json).nfseRoute.competenceDate,'2026-10-31');
   assert.equal((await ws.getFiscalEvents(draft.id)).at(-1).event_type,'COMPETENCIA_REVISADA');
   await assert.rejects(ws.submitFiscalDocument(draft.id),/canal|emissor/i);
   assert.equal(calls.length,0);
   await ws.reviseNfseDraftRoute(draft.id,{competenceDate:'2026-11-05'});
   assert.equal(JSON.parse((await ws.getFiscalDocument(draft.id)).snapshot_json).nfseRoute.channel,'NACIONAL');
 }finally{db.close()}
});
