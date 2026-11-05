import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {bundledFiscalCatalogPath,loadFiscalCatalog} from '../src/platform/fiscal-official-catalog.js';

test('distribuição inclui o snapshot oficial completo sem ação do cliente',()=>{
 const path=bundledFiscalCatalogPath();
 assert.equal(existsSync(path),true,'Catálogo fiscal não foi incorporado ao pacote');
 const data=loadFiscalCatalog({path});
 assert.ok(data.tables.ncm.length>=8000,'NCM oficial incompleta');
 assert.ok(data.tables.cfop.length>=550,'CFOP oficial incompleta');
 assert.ok(data.tables.ibscbs.length>=150,'IBS/CBS cClassTrib oficial incompleta');
 assert.ok(data.tables.cfop.includes('1101'),'CFOP entrante oficial precisa constar na tabela integral');
 assert.ok(data.tables.cfop.includes('5102'),'CFOP de saída deve estar na tabela');
 assert.ok(data.tables.ibscbs.some(x=>x.cClassTrib==='000001'),'Classificação cClassTrib ausente');
 assert.match(data.sources.cfop.version,/2\.10/);
 assert.match(data.sources.ibscbs.version,/1\.71/);
});
