import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadFiscalCatalog,validateFiscalClassification} from '../src/platform/fiscal-official-catalog.js';

const source='https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx';
function fixture(){
 const tables={
  ncm:['84212300'],cfop:['5102','6102'],
  ibscbs:[
   {cst:'000',cClassTrib:'000001',regime:'REGULAR',reduction:false,deferral:false},
   {cst:'200',cClassTrib:'200001',regime:'REDUCAO',reduction:true,deferral:false},
   {cst:'510',cClassTrib:'510001',regime:'DIFERIMENTO',reduction:false,deferral:true}
  ]
 };
 const sources=Object.fromEntries(['ncm','cfop','ibscbs'].map(n=>[n,{
  url:source,version:'fixture-only',publishedAt:'2026-10-30'}]));
 const payload={schemaVersion:1,checkedAt:'2026-11-05',sources,tables};
 return {...payload,digest:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
test('catálogo é carregado com integridade e código exato CST × cClassTrib',()=>{
 const root=mkdtempSync(join(tmpdir(),'fiscal-catalog-'));
 try{
  const path=join(root,'catalog.json');writeFileSync(path,JSON.stringify(fixture()));
  const catalog=loadFiscalCatalog({path,now:'2026-11-05'});
  assert.equal(validateFiscalClassification({catalog,ncm:'84212300',cfop:'5102',cst:'200',cClassTrib:'200001'}).regime,'REDUCAO');
  assert.throws(()=>validateFiscalClassification({catalog,ncm:'00000000',cfop:'5102'}),/NCM/i);
  assert.throws(()=>validateFiscalClassification({catalog,ncm:'84212300',cfop:'6101'}),/CFOP/i);
  assert.throws(()=>validateFiscalClassification({catalog,ncm:'84212300',cfop:'5102',cst:'200',cClassTrib:'200999'}),/cClassTrib/i);
 }finally{rmSync(root,{force:true,recursive:true});}
});
test('falha fechada se catálogo foi adulterado, desatualizado ou veio de domínio não oficial',()=>{
 const root=mkdtempSync(join(tmpdir(),'fiscal-catalog-'));
 try{
  const path=join(root,'catalog.json'),data=fixture();
  writeFileSync(path,JSON.stringify({...data,digest:'0'.repeat(64)}));
  assert.throws(()=>loadFiscalCatalog({path,now:'2026-11-05'}),/integridade|hash|digest/i);
  writeFileSync(path,JSON.stringify(data));
  assert.throws(()=>loadFiscalCatalog({path,now:'2027-01-10'}),/desatualizado|revisão/i);
  const altered=fixture();altered.sources.cfop.url='https://exemplo.com/tabela';
  altered.digest=createHash('sha256').update(JSON.stringify({schemaVersion:altered.schemaVersion,
    checkedAt:altered.checkedAt,sources:altered.sources,tables:altered.tables})).digest('hex');
  writeFileSync(path,JSON.stringify(altered));
  assert.throws(()=>loadFiscalCatalog({path,now:'2026-11-05'}),/fonte oficial|origem/i);
 }finally{rmSync(root,{force:true,recursive:true});}
});
test('não permite cClassTrib sem catálogo oficial local',()=>{
 assert.throws(()=>validateFiscalClassification({catalog:null,ncm:'84212300',cfop:'5102',cst:'000',cClassTrib:'000001'}),/catálogo|tabela/i);
});
