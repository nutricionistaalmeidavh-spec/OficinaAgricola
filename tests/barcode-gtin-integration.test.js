import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function scanner(){
 const window={};
 vm.runInNewContext(readFileSync('public/barcode-scanner.js','utf8'),{
  window,document:{},navigator:{},console,Date,setTimeout,clearTimeout,URLSearchParams
 },{filename:'barcode-scanner.js'});
 return window.OficinaBarcode;
}
test('leitor unificado localiza GTIN validado diretamente sem confundir com SKU',async()=>{
 const engine=scanner(),queries=[];
 const fetchPage=async path=>{queries.push(path);return {id:91,sku:'FILTRO-B',barcode:'5901234123457',quantity:4}};
 assert.equal(engine.isValidGtin('5901234123457'),true);
 assert.equal(engine.isValidGtin('5901234123458'),false);
 assert.equal(engine.isValidGtin('123'),false);
 assert.equal((await engine.findPartByCode('5901234123457',fetchPage)).id,91);
 assert.deepEqual(queries,['/api/parts/barcode/5901234123457']);
});
test('se GTIN não existir, busca SKU exato sem confusão por aproximação',async()=>{
 const engine=scanner(),queries=[];
 const fetchPage=async path=>{
  queries.push(path);
  if(path.startsWith('/api/parts/barcode/'))throw Error('Código não encontrado');
  return {items:[{id:8,sku:'5901234123457',barcode:null}],nextCursor:null};
 };
 assert.equal((await engine.findPartByCode('5901234123457',fetchPage)).id,8);
 assert.equal(queries.length,2);
 assert.match(queries[1],/search=5901234123457/);
});
test('leitor mantém SKUs não GTIN, e erros internos não são ocultados',async()=>{
 const engine=scanner();
 const find=async path=>{
  assert.match(path,/\/api\/parts\/page/);
  return {items:[{id:4,sku:'ABC-12',description:'Filtro'}],nextCursor:null};
 };
 assert.equal((await engine.findPartByCode('ABC-12',find)).id,4);
 await assert.rejects(engine.findPartByCode('5901234123457',async()=>{throw Error('Banco indisponível')}),/Banco indisponível/);
});
