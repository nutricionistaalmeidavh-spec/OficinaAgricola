import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateTaxProfile,assembleAssistedTaxReview} from '../src/platform/fiscal-tax-review.js';
import {compileReviewedFiscalIni} from '../src/platform/fiscal-ini-preparer.js';

const issuer={cnpj:'11222333000181',uf:'MG',municipalityIbge:'3106200',taxRegime:'SIMPLES',
 stateRegistration:'12345678',environment:'HOMOLOGACAO'};
const snapshot=JSON.stringify({originType:'OS',originId:12,kind:'NFE',customer:{
 name:'Comprador',document:'11222333000181'
},lines:[{kind:'PECA',sourceItemId:99,description:'Filtro',quantity:2,
 unitPriceCents:4500,subtotalCents:9000,discountCents:1000,totalCents:8000}]});
const doc={id:15,kind:'NFE',status:'RASCUNHO',snapshot_json:snapshot,
 snapshot_hash:createHash('sha256').update(snapshot).digest('hex'),
 amount_cents:8000,environment:'HOMOLOGACAO'};
const company={legalName:'Oficina Exemplo LTDA',street:'Rua Teste',number:'15',
 district:'Centro',city:'Uberaba',zip:'38010000'};
const customer={name:'Comprador',street:'Rua Um',number:'20',district:'Centro',
 city:'Uberaba',uf:'MG',municipalityIbge:'3106200',zip:'38010001'};
const goods={kind:'GOODS',name:'Filtros standard',ncm:'84212300',cfop:'5102',
 origin:'0',icmsScheme:'CSOSN',icmsCode:'102',pisCst:'49',cofinsCst:'49',unit:'UN'};
test('classificações tributárias são explícitas e bloqueiam código inválido',()=>{
 assert.equal(validateTaxProfile(goods,{issuer}).ncm,'84212300');
 assert.throws(()=>validateTaxProfile({...goods,ncm:'8421'},{issuer}),/NCM/);
 assert.throws(()=>validateTaxProfile({...goods,cfop:'5102\n[Emitente]'},{issuer}),/CFOP/);
 assert.throws(()=>validateTaxProfile({...goods,icmsScheme:'CST'},{issuer}),/regime|CSOSN|CST/i);
 assert.throws(()=>validateTaxProfile({...goods,icmsCode:'900'},{issuer}),/CSOSN|avançada/i);
});
test('serviço municipal exige município e código de lista informados',()=>{
 const service={kind:'SERVICE',name:'Revisão hidráulica',municipalityIbge:'3106200',
  serviceListCode:'14.01',municipalServiceCode:'123',cnae:'4520001',
  issRate:'3.00',withheld:false};
 const rule=validateTaxProfile(service,{issuer});
 assert.equal(rule.kind,'SERVICE');
 assert.throws(()=>validateTaxProfile({...service,serviceListCode:''},{issuer}),/serviço|lista/i);
 assert.throws(()=>validateTaxProfile({...service,municipalityIbge:'3550308'},{issuer}),/município/i);
});
test('formulário gera INI validado e vinculado ao snapshot, sem editar arquivo',()=>{
 const review=assembleAssistedTaxReview({document:doc,issuer,company,customer,
  issuance:{number:'123',series:'1',nature:'Venda de mercadorias'},
  items:[{profileId:'filtro'}],profiles:[{...goods,id:'filtro'}]});
 const compiled=compileReviewedFiscalIni({document:doc,issuer,review});
 assert.match(compiled.ini,/\[Produto001\]/);
 assert.match(compiled.ini,/NCM=84212300/);
 assert.match(compiled.ini,/CFOP=5102/);
 assert.match(compiled.ini,/CSOSN=102/);
 assert.match(compiled.ini,/vNF=80\.00/);
 assert.equal(review.snapshotHash,doc.snapshot_hash);
});
test('revisão recusa documentos já transmitidos, perfil ausente e fraude de destinatário',()=>{
 assert.throws(()=>assembleAssistedTaxReview({document:{...doc,status:'INDETERMINADO'},issuer,company,customer,
  issuance:{number:'123',series:'1',nature:'Venda'},items:[{profileId:'filtro'}],
  profiles:[{...goods,id:'filtro'}]}),/rascunho|RASCUNHO/i);
 assert.throws(()=>assembleAssistedTaxReview({document:doc,issuer,company,customer,
  issuance:{number:'123',series:'1',nature:'Venda'},items:[{profileId:'missing'}],
  profiles:[{...goods,id:'filtro'}]}),/perfil|classifica/i);
});
