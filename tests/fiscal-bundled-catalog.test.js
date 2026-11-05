import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {loadConfiguredFiscalCatalog,bundledFiscalCatalogPath} from '../src/platform/fiscal-official-catalog.js';

const source='https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx';
const makeCatalog=()=>{
 const sources=Object.fromEntries(['ncm','cfop','ibscbs'].map(k=>[k,{url:source,version:'fixture',publishedAt:'2026-10-30'}]));
 const tables={ncm:['84212300'],cfop:['5102'],ibscbs:[
  {cst:'000',cClassTrib:'000001',regime:'REGULAR',reduction:false,deferral:false}
 ]};
 const base={schemaVersion:1,checkedAt:'2026-11-05',sources,tables};
 return {...base,digest:createHash('sha256').update(JSON.stringify(base)).digest('hex')};
};
test('sem variável do cliente, carrega catálogo fiscal empacotado offline',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bundled-tax-')),path=join(dir,'catalog.json');
 const old=process.env.OFICINA_FISCAL_CATALOG_PATH;
 try{
  delete process.env.OFICINA_FISCAL_CATALOG_PATH;
  writeFileSync(path,JSON.stringify(makeCatalog()));
  const result=loadConfiguredFiscalCatalog({now:'2026-11-05',bundledPath:path});
  assert.equal(result.tables.ncm[0],'84212300');
  assert.match(bundledFiscalCatalogPath(),/fiscal-data[/\\]catalog\.json$/);
 }finally{if(old===undefined)delete process.env.OFICINA_FISCAL_CATALOG_PATH;
   else process.env.OFICINA_FISCAL_CATALOG_PATH=old;
   rmSync(dir,{force:true,recursive:true});}
});
test('operador self-hosted pode optar por catálogo externo, sem sobrescrever bundlado',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bundled-tax-')),
   path=join(dir,'catalog.json'),external=join(dir,'external.json');
 const old=process.env.OFICINA_FISCAL_CATALOG_PATH;
 try{
  writeFileSync(path,'invalid-should-not-be-read');
  writeFileSync(external,JSON.stringify(makeCatalog()));
  process.env.OFICINA_FISCAL_CATALOG_PATH=external;
  assert.equal(loadConfiguredFiscalCatalog({now:'2026-11-05',bundledPath:path}).tables.cfop[0],'5102');
 }finally{if(old===undefined)delete process.env.OFICINA_FISCAL_CATALOG_PATH;
   else process.env.OFICINA_FISCAL_CATALOG_PATH=old;
   rmSync(dir,{force:true,recursive:true});}
});
test('não existe fallback de tabela demo quando pacote oficial está ausente',()=>{
 const old=process.env.OFICINA_FISCAL_CATALOG_PATH;
 try{
  delete process.env.OFICINA_FISCAL_CATALOG_PATH;
  assert.equal(loadConfiguredFiscalCatalog({now:'2026-11-05',bundledPath:'/nonexistent/catalog.json'}),null);
 }finally{if(old===undefined)delete process.env.OFICINA_FISCAL_CATALOG_PATH;
   else process.env.OFICINA_FISCAL_CATALOG_PATH=old;}
});
