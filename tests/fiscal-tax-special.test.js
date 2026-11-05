import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReviewedTaxItems} from '../src/platform/fiscal-tax-assist.js';

const catalog={tables:{
 ncm:['84212300'],cfop:['5102'],
 ibscbs:[
  {cst:'000',cClassTrib:'000001',regime:'REGULAR',reduction:false,deferral:false},
  {cst:'200',cClassTrib:'200001',regime:'REDUCAO',reduction:true,deferral:false},
  {cst:'510',cClassTrib:'510001',regime:'DIFERIMENTO',reduction:false,deferral:true}
 ]}};
function review(cst,code){
 return {catalog,issuer:{taxRegime:'SIMPLES',environment:'HOMOLOGACAO',uf:'SP'},
  sections:{
   Identificacao:{idDest:'1',dhEmi:'05/11/2026 12:00:00'},
   Produto001:{NCM:'84212300',CFOP:'5102'},
   ICMS001:{orig:'0',CSOSN:'102'},PIS001:{CST:'49'},COFINS001:{CST:'49'},
   IBSCBS001:{CST:cst,cClassTrib:code},
   gIBSCBS001:{vBC:'100.00',vIBS:'0.06'},
   gIBSUF001:{pIBSUF:'0.10',vIBSUF:'0.06',pRedAliq:'40.00',pAliqEfet:'0.06'},
   gIBSMun001:{pIBSMun:'0.00',vIBSMun:'0.00',pRedAliq:'40.00',pAliqEfet:'0.00'},
   gCBS001:{pCBS:'0.90',vCBS:'0.54',pRedAliq:'40.00',pAliqEfet:'0.54'}
  },lines:[{totalCents:10000}]};
}
test('redução de alíquota usa cClassTrib oficial e alíquota efetiva em cada imposto',()=>{
 assert.equal(validateReviewedTaxItems(review('200','200001')),true);
 const wrong=review('200','200001');wrong.sections.gIBSUF001.pAliqEfet='0.07';
 assert.throws(()=>validateReviewedTaxItems(wrong),/efetiva|redução/i);
 const missing=review('200','200001');delete missing.sections.gCBS001.pRedAliq;
 assert.throws(()=>validateReviewedTaxItems(missing),/redução|complet/i);
});
test('diferimento só é aceito com cClassTrib compatível e valores conferidos',()=>{
 const data=review('510','510001');
 for(const [prefix,baseRate,expected] of [
  ['gIBSUF','0.10','0.05'],['gIBSMun','0.00','0.00'],['gCBS','0.90','0.45']
 ]){
  const group=data.sections[prefix+'001'];
  delete group.pRedAliq;delete group.pAliqEfet;
  group['pDif']='50.00';group['vDif']=expected;
  group[prefix==='gIBSUF'?'vIBSUF':prefix==='gIBSMun'?'vIBSMun':'vCBS']=expected;
 }
 data.sections.gIBSCBS001.vIBS='0.05';
 assert.equal(validateReviewedTaxItems(data),true);
 data.sections.gCBS001.vDif='0.25';
 assert.throws(()=>validateReviewedTaxItems(data),/diferimento|vDif/i);
});
test('regime especial sem registro oficial local ou flags correspondentes é bloqueado',()=>{
 const data=review('200','200001');data.catalog=null;
 assert.throws(()=>validateReviewedTaxItems(data),/catálogo|tabela/i);
 data.catalog=catalog;data.sections.IBSCBS001.cClassTrib='200002';
 assert.throws(()=>validateReviewedTaxItems(data),/cClassTrib/i);
 const regular=review('000','000001'); 
 assert.throws(()=>validateReviewedTaxItems(regular),/redução|regime/i);
});
