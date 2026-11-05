import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function loadBarcode(){
  const window={};
  vm.runInNewContext(readFileSync('public/barcode-scanner.js','utf8'),{
    window,document:{},console,Date,setTimeout,clearTimeout,
  },{filename:'barcode-scanner.js'});
  return window.OficinaBarcode;
}

test('normaliza código sem descartar zero inicial nem alterar SKU',()=>{
  const scanner=loadBarcode();
  assert.equal(scanner.normalizeCode(' \r0012345678905\n '),'0012345678905');
  assert.equal(scanner.normalizeCode(' ABc-123  '),'ABc-123');
  assert.throws(()=>scanner.normalizeCode(' \n '),/vazio/i);
  assert.throws(()=>scanner.normalizeCode('A'.repeat(129)),/128/);
});

test('bloqueia só a leitura duplicada imediata e admite repetição deliberada',()=>{
  const scanner=loadBarcode();
  const accept=scanner.createDeduper(800);
  assert.equal(accept('7891234567895',1000),true);
  assert.equal(accept('7891234567895',1200),false);
  assert.equal(accept('SKU-2',1300),true);
  assert.equal(accept('7891234567895',2000),true);
});

test('consulta paginada exige SKU exatamente igual e não seleciona correspondência parcial',async()=>{
  const scanner=loadBarcode();
  const queries=[];
  const lookup=async url=>{
    queries.push(url);
    return queries.length===1?
      {items:[{id:1,sku:'ABC-90'}],nextCursor:'next'}:
      {items:[{id:2,sku:'ABC-9',description:'Filtro',active:1}],nextCursor:null};
  };
  const result=await scanner.findPartBySku('ABC-9',lookup);
  assert.equal(result.id,2);
  assert.equal(queries.length,2);
  assert.match(queries[0],/search=ABC-9/);
  assert.match(queries[1],/cursor=next/);
});

test('consulta não confunde código desconhecido com uma peça',async()=>{
  const scanner=loadBarcode();
  assert.equal(await scanner.findPartBySku('inexistente',async()=>({items:[{sku:'inexistente-2'}],nextCursor:null})),null);
});

test('componente oferece leitor, digitação e câmera, sem executar baixa de estoque',()=>{
  const scanner=loadBarcode();
  const html=scanner.markup('inventory');
  assert.match(html,/data-barcode-input/);
  assert.match(html,/data-barcode-camera/);
  assert.match(html,/data-barcode-status/);
  assert.doesNotMatch(html,/api\/sales|inventory\/movements/);
});
