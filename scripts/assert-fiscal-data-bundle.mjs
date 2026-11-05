// Gate offline para impedir publicar instalador com tabelas de teste/parciais.
import {existsSync,readFileSync} from 'node:fs';
import {bundledFiscalCatalogPath,loadFiscalCatalog} from '../src/platform/fiscal-official-catalog.js';
const file=bundledFiscalCatalogPath();
if(!existsSync(file))throw Error('Catálogo fiscal oficial não embutido: impedir release');
const catalog=loadFiscalCatalog({path:file});
const {ncm,cfop,ibscbs}=catalog.tables;
if(ncm.length<8000||cfop.length<550||ibscbs.length<150)
  throw Error('Tabela fiscal oficial incompleta: impedir release');
if(!cfop.includes('1101')||!cfop.includes('5102')||
   !ibscbs.some(row=>row.cClassTrib==='000001'&&row.cst==='000'))
  throw Error('Exemplos essenciais oficiais ausentes do pacote fiscal');
if(!catalog.sources.cfop.version.includes('2.10')||
   !catalog.sources.ibscbs.version.includes('1.71')||
   !String(catalog.sources.ncm.version).includes('Vigente em'))
  throw Error('Versões fiscais 2026 não correspondem às fontes do build');
for(const name of ['ncm','cfop','ibscbs']){
  if(!/^[0-9a-f]{64}$/.test(catalog.sources[name].sha256||''))
    throw Error('Proveniência SHA-256 ausente na fonte '+name);
}
const path='src/platform/fiscal-data/catalog.json';
const raw=readFileSync(path,'utf8');
if(raw.includes('fixture-only')||raw.includes('exemplo.com'))
  throw Error('Dados de teste encontrados no catálogo distribuído');
console.log('Catálogo oficial válido e incluído: NCM',ncm.length,'CFOP',cfop.length,
 'IBS/CBS',ibscbs.length,'Snapshot',catalog.checkedAt,'Digest',catalog.digest);
