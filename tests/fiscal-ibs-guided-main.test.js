import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assembleAssistedTaxReview} from '../src/platform/fiscal-tax-review.js';
import {compileReviewedFiscalIni} from '../src/platform/fiscal-ini-preparer.js';

const issuer={cnpj:'11222333000181',uf:'SP',municipalityIbge:'3550308',environment:'HOMOLOGACAO',
 taxRegime:'SIMPLES',stateRegistration:'12345'};
const snapshot_json=JSON.stringify({originType:'VENDA',lines:[{
 kind:'PECA',description:'Filtro',sourceItemId:2,quantity:1,
 unitPriceCents:9000,subtotalCents:9000,discountCents:0,totalCents:9000
}],customer:{}});
const document={id:55,kind:'NFCE',status:'RASCUNHO',amount_cents:9000,environment:'HOMOLOGACAO',
 snapshot_json,snapshot_hash:createHash('sha256').update(snapshot_json).digest('hex')};
const company={legalName:'Oficina Verificada',street:'Rua A',number:'10',
 district:'Centro',city:'São Paulo',zip:'01001000'};
const profile={id:'filtro',kind:'GOODS',name:'Filtros',ncm:'84212300',cfop:'5102',
 origin:'0',icmsScheme:'CSOSN',icmsCode:'102',pisCst:'49',cofinsCst:'49',unit:'UN'};
const catalog={tables:{ncm:['84212300'],cfop:['5102'],ibscbs:[
 {cst:'000',cClassTrib:'000001',regime:'REGULAR',reduction:false,deferral:false}
]}};
test('formulário guiado preserva perfil NCM/CFOP e acrescenta IBS/CBS tipado e consolidado',()=>{
 const review=assembleAssistedTaxReview({document,issuer,company,
  issuance:{number:'55',series:'1',nature:'Venda',paymentCode:'01'},
  items:[{profileId:'filtro',ibscbs:{cst:'000',cClassTrib:'000001',
   base:'90.00',ufRate:'0.10',munRate:'0.00',cbsRate:'0.90'}}],
  profiles:[profile]});
 assert.equal(review.sections.IBSCBS001.cClassTrib,'000001');
 assert.equal(review.sections.gIBSUF001.vIBSUF,'0.09');
 assert.equal(review.sections.gCBS001.vCBS,'0.81');
 const ini=compileReviewedFiscalIni({document,issuer,review,catalog}).ini;
 assert.match(ini,/\[IBSCBSTot\]/);
 assert.match(ini,/\[gCBSTot\]/);
 assert.match(ini,/NCM=84212300/);
 assert.match(ini,/vNF=90\.00/);
});
test('IBS/CBS incompleto e alíquota inválida são rejeitados pelo servidor',()=>{
 const build=ibscbs=>assembleAssistedTaxReview({document,issuer,company,
  issuance:{number:'55',series:'1',nature:'Venda',paymentCode:'01'},
  items:[{profileId:'filtro',ibscbs}],profiles:[profile]});
 assert.throws(()=>build({cst:'000',cClassTrib:'000001',base:'90.00'}),/IBS|alíquota|obrigatório/i);
 assert.throws(()=>build({cst:'000',cClassTrib:'000001',base:'90.00',
   ufRate:'110.00',munRate:'0.00',cbsRate:'0.90'}),/alíquota|IBS/i);
});
