import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReviewedTaxItems} from '../src/platform/fiscal-tax-assist.js';

const base=()=>({
 issuer:{taxRegime:'SIMPLES',uf:'SP',environment:'HOMOLOGACAO'},
 sections:{
  Identificacao:{idDest:'1'},
  Produto001:{NCM:'84212300',CFOP:'5102'},
  ICMS001:{orig:'0',CSOSN:'102'},
  PIS001:{CST:'49'},COFINS001:{CST:'49'}
 },
 lines:[{totalCents:8000}]
});

test('revisão aceita códigos fornecidos sem sugerir enquadramento tributário',()=>{
 const data=base();
 assert.equal(validateReviewedTaxItems(data),true);
});

test('regime do emitente exige CSOSN para Simples e CST para Normal',()=>{
 const simple=base();simple.sections.ICMS001={orig:'0',CST:'00'};
 assert.throws(()=>validateReviewedTaxItems(simple),/CSOSN/i);
 const normal=base();normal.issuer.taxRegime='NORMAL';
 assert.throws(()=>validateReviewedTaxItems(normal),/CST.*ICMS/i);
 normal.sections.ICMS001={orig:'0',CST:'00',vBC:'80.00',pICMS:'18.00',vICMS:'14.40'};
 assert.equal(validateReviewedTaxItems(normal),true);
});

test('não aceita CFOP incompatível com destino ou códigos tributários malformados',()=>{
 const data=base();data.sections.Produto001.CFOP='6102';
 assert.throws(()=>validateReviewedTaxItems(data),/CFOP/i);
 data.sections.Identificacao.idDest='2';
 assert.equal(validateReviewedTaxItems(data),true);
 data.sections.PIS001.CST='xx';
 assert.throws(()=>validateReviewedTaxItems(data),/PIS/i);
});

test('valida base, alíquota e valor de PIS/COFINS sem inventar números',()=>{
 const data=base();
 data.sections.PIS001={CST:'01',vBC:'80.00',pPIS:'1.65',vPIS:'1.32'};
 assert.equal(validateReviewedTaxItems(data),true);
 data.sections.PIS001.vPIS='2.00';
 assert.throws(()=>validateReviewedTaxItems(data),/PIS.*valor|PIS.*cálculo/i);
 data.sections.PIS001={CST:'01',vBC:'80.00'};
 assert.throws(()=>validateReviewedTaxItems(data),/PIS.*complet/i);
});

test('IBS/CBS informado exige classificação coerente e cálculo por item',()=>{
 const data=base();
 Object.assign(data.sections,{
  IBSCBS001:{CST:'000',cClassTrib:'000001'},
  gIBSCBS001:{vBC:'80.00',vIBS:'0.08'},
  gIBSUF001:{pIBSUF:'0.10',vIBSUF:'0.08'},
  gIBSMun001:{pIBSMun:'0.00',vIBSMun:'0.00'},
  gCBS001:{pCBS:'0.90',vCBS:'0.72'}
 });
 assert.equal(validateReviewedTaxItems(data),true);
 data.sections.IBSCBS001.cClassTrib='200001';
 assert.throws(()=>validateReviewedTaxItems(data),/cClassTrib/i);
 data.sections.IBSCBS001.cClassTrib='000001';
 data.sections.gCBS001.vCBS='1.00';
 assert.throws(()=>validateReviewedTaxItems(data),/CBS.*valor|CBS.*cálculo/i);
});

test('grupos IBS/CBS incompletos e múltiplos regimes são rejeitados',()=>{
 const data=base();data.sections.IBSCBS001={CST:'000',cClassTrib:'000001'};
 assert.throws(()=>validateReviewedTaxItems(data),/IBS.CBS.*complet/i);
 delete data.sections.IBSCBS001;
 data.sections.gCBS001={pCBS:'0.90',vCBS:'0.72'};
 assert.throws(()=>validateReviewedTaxItems(data),/IBS.CBS/i);
});

test('códigos fiscais fora da tabela reconhecida exigem revisão em vez de seguir para emissão',()=>{
 const data=base();
 data.sections.ICMS001.CSOSN='999';
 assert.throws(()=>validateReviewedTaxItems(data),/CSOSN/);
 data.sections.ICMS001.CSOSN='102';
 data.sections.PIS001.CST='00';
 assert.throws(()=>validateReviewedTaxItems(data),/PIS/);
});
