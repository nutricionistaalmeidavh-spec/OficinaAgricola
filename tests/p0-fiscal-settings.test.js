import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,transitionWorkOrder} from '../src/services/work-orders.js';
import {saveQuote,approveQuote} from '../src/services/quotes.js';
import {createFiscalDraft,getFiscalDocument,submitFiscalDocument} from '../src/services/fiscal.js';
import {getFiscalSettings,setFiscalSettings} from '../src/services/fiscal-settings.js';

const config={issuerCnpj:'11.222.333/0001-81',issuerUf:'MG',municipalityIbge:'3170107',taxRegime:'SIMPLES',enabled:true};
function makeDraft(db){
  const c=createCustomer(db,{name:'Cliente Teste'});
  const m=createMachine(db,{customerId:c.id,type:'CARRO'});
  const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Revisão'});
  transitionWorkOrder(db,os.id,'DIAGNOSTICO');
  saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:5000}]});
  approveQuote(db,os.id);
  return createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFSE',requestId:'doc-1'});
}

test('Fiscal P0: configurações locais são opt-in, validadas e não contêm secrets',()=>{
  const db=openDatabase(':memory:');
  try{
    migrate(db);migrateAssistencia(db);
    assert.equal(getFiscalSettings(db).enabled,0);
    assert.throws(()=>setFiscalSettings(db,{enabled:true}),/Complete/);
    assert.throws(()=>setFiscalSettings(db,{issuerCnpj:'00000000000000'}),/CNPJ/);
    const active=setFiscalSettings(db,config);
    assert.equal(active.issuer_cnpj,'11222333000181');
    assert.equal(active.environment,'HOMOLOGACAO');
    assert.equal(active.enabled,1);
    assert.throws(()=>setFiscalSettings(db,{environment:'PRODUCAO'}),/Produção exige confirmação/);
    assert.equal(getFiscalSettings(db).environment,'HOMOLOGACAO');
    const production=setFiscalSettings(db,{environment:'PRODUCAO',productionConfirmed:true});
    assert.equal(production.environment,'PRODUCAO');
    assert.equal(production.production_confirmed,1);
    assert.ok(!Object.keys(production).some(k=>/password|private_key|certificate|token/i.test(k)));
  }finally{db.close()}
});

test('Fiscal P0: documento congelado em homologação não pode ser enviado em produção',async()=>{
  const db=openDatabase(':memory:');
  try{
    migrate(db);migrateAssistencia(db);setFiscalSettings(db,config);
    const draft=makeDraft(db);
    assert.equal(draft.environment,'HOMOLOGACAO');
    setFiscalSettings(db,{environment:'PRODUCAO',productionConfirmed:true});
    let calls=0;
    await assert.rejects(()=>submitFiscalDocument(db,draft.id,{provider:{transmit:async()=>{calls++;return {status:'REJEITADA'}}}}),/outro ambiente/);
    assert.equal(calls,0);
    assert.equal(getFiscalDocument(db,draft.id).status,'RASCUNHO');
  }finally{db.close()}
});

test('Fiscal P0: retorno de autorização em ambiente divergente nunca é marcado autorizado',async()=>{
  const db=openDatabase(':memory:');
  try{
    migrate(db);migrateAssistencia(db);setFiscalSettings(db,config);
    const draft=makeDraft(db);
    const provider={name:'teste',transmit:async()=>({
      status:'AUTORIZADA',environment:'PRODUCAO',accessKey:'fake',protocol:'fake',xml:'<fake />'
    })};
    await assert.rejects(()=>submitFiscalDocument(db,draft.id,{provider}),/Ambiente fiscal/);
    assert.equal(getFiscalDocument(db,draft.id).status,'INDETERMINADO');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
  }finally{db.close()}
});
