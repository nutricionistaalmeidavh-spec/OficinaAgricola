import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function loadBarcode({window={},navigator={},document={}}={}){
  vm.runInNewContext(readFileSync('public/barcode-scanner.js','utf8'),{
    window,document,navigator,console,Date,setTimeout,clearTimeout,URLSearchParams,
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

function fakePanel(){
  const nodes={};
  for(const id of ['input','camera','stop','video','status']){
    nodes[id]={hidden:id==='video'||id==='stop',disabled:false,handlers:{},
      addEventListener(event,callback){this.handlers[event]=callback;},
      focus(){this.focused=true;}};
  }
  nodes.video.play=async()=>{};
  nodes.video.pause=()=>{};
  nodes.video.readyState=2;
  nodes.input.value='';
  const selectors={
    '[data-barcode-input]':nodes.input,
    '[data-barcode-camera]':nodes.camera,
    '[data-barcode-stop]':nodes.stop,
    '[data-barcode-video]':nodes.video,
    '[data-barcode-status]':nodes.status
  };
  const panel={isConnected:true,dataset:{},
    querySelector(selector){return selectors[selector]||null;},
    closest(){return null;}};
  return {nodes,panel};
}

test('leitor teclado só envia após Enter e ignora duplicata imediata',async()=>{
  const scanner=loadBarcode();
  const {nodes,panel}=fakePanel();
  const scanned=[];
  scanner.attach(panel,async code=>{scanned.push(code);return 'Identificado';});
  nodes.input.value='0009876543210';
  nodes.input.handlers.keydown({key:'a',preventDefault(){}});
  assert.equal(scanned.length,0);
  nodes.input.handlers.keydown({key:'Enter',preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scanned.join(','),'0009876543210');
  nodes.input.value='0009876543210';
  nodes.input.handlers.keydown({key:'Enter',preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scanned.length,1);
  assert.equal(nodes.status.textContent,'Identificado');
});

test('câmera nativa fecha stream após leitura, sem gravar operação',async()=>{
  const {nodes,panel}=fakePanel();
  let stopped=0;
  const stream={getTracks:()=>[{stop(){stopped++;}}]};
  class Detector{
    static async getSupportedFormats(){return ['ean_13'];}
    async detect(){return [{rawValue:'7891234567895',format:'ean_13'}];}
  }
  const barcode=loadBarcode({
    window:{BarcodeDetector:Detector},
    navigator:{mediaDevices:{getUserMedia:async()=>stream}}
  });
  const got=[];
  barcode.attach(panel,async code=>{got.push(code);return 'Lido';});
  nodes.camera.handlers.click();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(got.join(','),'7891234567895');
  assert.equal(stopped,1);
  assert.equal(nodes.video.srcObject,null);
  assert.equal(nodes.video.hidden,true);
});

test('permissão de câmera negada mantém a entrada manual habilitada',async()=>{
  const {nodes,panel}=fakePanel();
  const barcode=loadBarcode({
    navigator:{mediaDevices:{getUserMedia:async()=>{const error=new Error('Denied');error.name='NotAllowedError';throw error;}}}
  });
  barcode.attach(panel,async()=>{});
  nodes.camera.handlers.click();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.match(nodes.status.textContent,/não autorizada/i);
  assert.equal(nodes.input.disabled,false);
  assert.equal(nodes.video.hidden,true);
});
