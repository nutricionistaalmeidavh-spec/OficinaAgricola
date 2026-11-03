import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,transitionWorkOrder} from '../src/services/work-orders.js';
import {saveQuote,approveQuote} from '../src/services/quotes.js';
import {createFiscalDraft,getFiscalDocument,submitFiscalDocument} from '../src/services/fiscal.js';
import {setFiscalSettings} from '../src/services/fiscal-settings.js';
import {createAcbrLibFiscalProvider} from '../src/platform/acbrlib-fiscal-provider.js';

const issuer={issuerCnpj:'11222333000181',issuerUf:'MG',municipalityIbge:'3170107',taxRegime:'SIMPLES',enabled:true};
function fiscalFixture(){
  const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);setFiscalSettings(db,issuer);
  const customer=createCustomer(db,{name:'Produtor'}),machine=createMachine(db,{customerId:customer.id,type:'TRATOR'});
  const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Revisão'});
  transitionWorkOrder(db,os.id,'DIAGNOSTICO');
  saveQuote(db,os.id,{items:[{kind:'PECA',description:'Filtro',quantity:1,unitPriceCents:15000}]});approveQuote(db,os.id);
  return {db,doc:createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFE',requestId:'acbr-fiscal'})};
}
function fixtures(){
  const root=mkdtempSync(join(tmpdir(),'oficina-acbr-'));
  mkdirSync(join(root,'inputs'));writeFileSync(join(root,'nfe.dll'),'no-native-exec');
  writeFileSync(join(root,'nfe.ini'),'[Principal]\nLogNivel=0\n');
  return {root,inputDir:join(root,'inputs'),nfeLib:join(root,'nfe.dll'),nfeConfig:join(root,'nfe.ini'),
    cleanup(){rmSync(root,{force:true,recursive:true})}};
}
function inputPair(f,doc,manifestOverrides={}){
  const base=join(f.inputDir,'NFE-'+doc.id+'-'+doc.snapshot_hash);
  writeFileSync(base+'.ini','[infNFe]\nversao=4.00\n');
  writeFileSync(base+'.json',JSON.stringify({kind:'NFE',documentId:doc.id,
    snapshotHash:doc.snapshot_hash,amountCents:doc.amount_cents,
    issuerCnpj:'11222333000181',environment:'HOMOLOGACAO',...manifestOverrides}));
}
test('ACBrLib é opcional: sem caminhos retorna null e sem binário não habilita transmissão',()=>{
  assert.equal(createAcbrLibFiscalProvider({}),null);
  assert.throws(()=>createAcbrLibFiscalProvider({nfeLib:'./nao-existe.dll',inputDir:'/tmp'}),
    /absoluto|configur/i);
});

test('ACBrLib: sem INI e manifesto fiscal a rejeição é anterior à marcação de envio incerto',async()=>{
  const f=fixtures(),{db,doc}=fiscalFixture();
  try{
    const provider=createAcbrLibFiscalProvider(f);
    await assert.rejects(()=>submitFiscalDocument(db,doc.id,{provider}),/INI|tributár|manifest|prepar/i);
    assert.equal(getFiscalDocument(db,doc.id).status,'RASCUNHO');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fiscal_events WHERE event_type=?').get('TRANSMISSAO_INICIADA').n,0);
  }finally{db.close();f.cleanup()}
});

test('ACBrLib: payload fiscal só é aceito se manifesto corresponde ao snapshot e emitente',async()=>{
  const f=fixtures(),{db,doc}=fiscalFixture();
  try{
    inputPair(f,doc,{amountCents:1});
    const provider=createAcbrLibFiscalProvider(f);
    await assert.rejects(()=>submitFiscalDocument(db,doc.id,{provider}),/manifest|valor|snapshot/i);
    assert.equal(getFiscalDocument(db,doc.id).status,'RASCUNHO');
    inputPair(f,doc);
    let args;
    const controlled=createAcbrLibFiscalProvider({...f,runner:async(input)=>{args=input;return {status:'INDETERMINADO'}}});
    const result=await submitFiscalDocument(db,doc.id,{provider:controlled});
    assert.equal(result.status,'INDETERMINADO');
    assert.equal(args.operation,'transmit');
    assert.equal(args.kind,'NFE');
    assert.equal(args.snapshotHash,doc.snapshot_hash);
    assert.match(args.iniPath,/\.ini$/);
    assert.equal(args.environment,'HOMOLOGACAO');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
  }finally{db.close();f.cleanup()}
});

test('ACBrLib: falha antes do preparo não inicia transmissão; sem NFSe configurada falha fechada',async()=>{
  const f=fixtures(),{db,doc}=fiscalFixture();
  try{
    inputPair(f,doc);
    const provider=createAcbrLibFiscalProvider(f);
    assert.equal(provider.name,'acbrlib-local');
    assert.throws(()=>provider.prepare({document:{...doc,kind:'NFSE'},issuer:{cnpj:'11222333000181',environment:'HOMOLOGACAO'}}),/NFSe|NFSE|biblioteca/i);
  }finally{db.close();f.cleanup()}
});
