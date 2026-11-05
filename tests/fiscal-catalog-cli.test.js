import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadFiscalCatalog} from '../src/platform/fiscal-official-catalog.js';

test('importa tabelas oficiais normalizadas offline e valida integridade do bundle',()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-table-import-'));
 try{
  const ncm=join(root,'ncm.csv'),cfop=join(root,'cfop.csv'),
   ibscbs=join(root,'ibscbs.csv'),sources=join(root,'source.json'),out=join(root,'out.json');
  writeFileSync(ncm,'NCM\n84212300\n');
  writeFileSync(cfop,'CFOP\n5102\n');
  writeFileSync(ibscbs,'CST,cClassTrib,regime,reduction,deferral\n000,000001,REGULAR,false,false\n');
  const metadata=Object.fromEntries(['ncm','cfop','ibscbs'].map(kind=>[kind,{
   version:'teste normalizado',url:'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx',
   publishedAt:'2026-10-30'
  }]));
  writeFileSync(sources,JSON.stringify(metadata));
  const cmd=spawnSync(process.execPath,[
   'scripts/import-fiscal-catalog.mjs','--ncm',ncm,'--cfop',cfop,
   '--ibscbs',ibscbs,'--sources',sources,'--out',out,'--checked-at','2026-11-05'
  ],{encoding:'utf8'});
  assert.equal(cmd.status,0,cmd.stderr);
  const loaded=loadFiscalCatalog({path:out,now:'2026-11-05'});
  assert.deepEqual(loaded.tables.ncm,['84212300']);
  assert.deepEqual(loaded.tables.cfop,['5102']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
