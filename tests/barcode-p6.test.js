import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function setup({window={},navigator={},document={},now=()=>Date.now()}={}){
  const elements={};
  for(const name of ['input','camera','stop','video','status']){
    const element={
      hidden:name==='video'||name==='stop',
      disabled:false,value:'',handlers:{},
      addEventListener(type,fn){this.handlers[type]=fn},
      focus(){this.focused=true}
    };
    elements[name]=element;
  }
  elements.video.readyState=2;
  elements.video.videoWidth=640;
  elements.video.videoHeight=480;
  elements.video.play=async()=>{};
  elements.video.pause=()=>{};
  const map={
    '[data-barcode-input]':'input',
    '[data-barcode-camera]':'camera',
    '[data-barcode-stop]':'stop',
    '[data-barcode-video]':'video',
    '[data-barcode-status]':'status'
  };
  const panel={
    isConnected:true,dataset:{},isHidden:false,
    querySelector(selector){return elements[map[selector]]||null},
    closest(){return this.isHidden?{}:null}
  };
  const context={window,navigator,document,console,Date,setTimeout,clearTimeout,URLSearchParams};
  vm.runInNewContext(readFileSync('public/barcode-scanner.js','utf8'),context,{filename:'barcode-scanner.js'});
  const press=(value,key='Enter')=>{
    elements.input.value=value;
    elements.input.handlers.keydown({key,isComposing:false,preventDefault(){}});
  };
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {barcode:window.OficinaBarcode,elements,panel,press,flush};
}

test('P6: erro de rede preserva código digitado e oferece nova tentativa imediata',async()=>{
  const ui=setup();
  let attempts=0;
  ui.barcode.attach(ui.panel,async()=>{
    attempts++;
    if(attempts===1)throw new Error('Servidor indisponível');
    return {state:'success',message:'Peça encontrada'};
  });
  ui.press('SKU-RETRY');
  await ui.flush();
  assert.match(ui.elements.status.textContent,/Servidor indisponível/);
  assert.equal(ui.elements.input.value,'SKU-RETRY');
  ui.press('SKU-RETRY');
  await ui.flush();
  assert.equal(attempts,2,'A tentativa após uma falha não deve ser bloqueada pelo debounce');
  assert.equal(ui.elements.status.textContent,'Peça encontrada');
});

test('P6: leitura repetida enquanto pesquisa está pendente não dispara uma segunda operação',async()=>{
  const ui=setup();
  let complete;
  const pending=new Promise(resolve=>{complete=resolve});
  const calls=[];
  ui.barcode.attach(ui.panel,async code=>{calls.push(code);await pending;return 'OK'});
  ui.press('0001234567890');
  ui.press('0001234567890');
  assert.equal(calls.length,1);
  assert.equal(ui.elements.input.disabled,true);
  complete();
  await ui.flush();
  assert.equal(calls.length,1);
  assert.equal(ui.elements.input.disabled,false);
});

test('P6: câmera solicita autorização após clique e libera dispositivo mesmo cancelada antes da autorização',async()=>{
  let resolvePermission,stops=0;
  const stream={getTracks:()=>[{stop(){stops++}}]};
  const permission=new Promise(resolve=>{resolvePermission=resolve});
  const ui=setup({navigator:{mediaDevices:{getUserMedia:()=>permission}}});
  ui.barcode.attach(ui.panel,async()=>{throw Error('Não pode pesquisar ao cancelar')});
  assert.equal(stops,0);
  ui.elements.camera.handlers.click();
  ui.barcode.stopCamera();
  resolvePermission(stream);
  await ui.flush();
  assert.equal(stops,1,'Faixas de câmera abertas após cancelamento precisam ser fechadas');
  assert.equal(ui.elements.video.hidden,true);
  assert.equal(ui.elements.camera.disabled,false);
});

test('P6: câmera interrompe leitura após fechar modal',async()=>{
  let stops=0;
  const stream={getTracks:()=>[{stop(){stops++}}]};
  class Detector{
    static async getSupportedFormats(){return ['ean_13']}
    async detect(){return []}
  }
  const ui=setup({window:{BarcodeDetector:Detector},navigator:{mediaDevices:{getUserMedia:async()=>stream}}});
  ui.barcode.attach(ui.panel,async()=>{throw Error('Não pode ler após fechar')});
  ui.elements.camera.handlers.click();
  await new Promise(resolve=>setTimeout(resolve,50));
  ui.panel.isHidden=true;
  await new Promise(resolve=>setTimeout(resolve,290));
  assert.equal(stops,1);
  assert.equal(ui.elements.video.hidden,true);
});

test('P6: câmera fallback Quagga2 funciona sem CDN, lê Code128 e encerra stream',async()=>{
  let stops=0,decoded=0;
  const stream={getTracks:()=>[{stop(){stops++}}]};
  const canvas={
    getContext:()=>({drawImage(){}}),
    toDataURL:()=> 'data:image/jpeg;base64,/9j/',
    width:0,height:0
  };
  const window={Quagga:{decodeSingle(options,callback){
    assert.equal(options.numOfWorkers,0);
    assert.ok(options.decoder.readers.includes('code_128_reader'));
    decoded++;
    callback({codeResult:{code:'OF-ABC-123',format:'code_128'}});
  }}};
  const ui=setup({
    window,
    document:{createElement(type){assert.equal(type,'canvas');return canvas}},
    navigator:{mediaDevices:{getUserMedia:async()=>stream}}
  });
  const recorded=[];
  ui.barcode.attach(ui.panel,async(code,{source})=>{recorded.push({code,source});return 'Encontrado'});
  ui.elements.camera.handlers.click();
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(decoded,1);
  assert.deepEqual(recorded,[{code:'OF-ABC-123',source:'camera'}]);
  assert.equal(stops,1);
});

test('P6: indisponibilidade de permissão/câmera mantém campo manual e não cria operação',()=>{
  const ui=setup();
  const results=[];
  ui.barcode.attach(ui.panel,async code=>{results.push(code);return 'Identificado'});
  ui.elements.camera.handlers.click();
  assert.match(ui.elements.status.textContent,/HTTPS|localhost/i);
  assert.equal(ui.elements.input.disabled,false);
  assert.equal(ui.elements.video.hidden,true);
  assert.deepEqual(results,[]);
});

test('P6: consulta exata não mistura SKUs numéricos com zero à esquerda',async()=>{
  const ui=setup();
  const url=[];
  const fetcher=async path=>{
    url.push(path);
    return {items:[{id:9,sku:'001234500'}],nextCursor:null};
  };
  assert.equal(await ui.barcode.findPartBySku('1234500',fetcher),null);
  assert.equal((await ui.barcode.findPartBySku('001234500',fetcher)).id,9);
  assert.equal(url.length,2);
});

test('P6: integração do scanner é somente consulta ou prévia, nunca grava movimento ao ler',()=>{
  const scanner=readFileSync('public/barcode-scanner.js','utf8');
  const inventory=readFileSync('public/app-operations.js','utf8');
  const sales=readFileSync('public/app-assistencia.js','utf8');
  const markup=readFileSync('public/index.html','utf8');
  const pwa=readFileSync('public/sw.js','utf8');
  assert.doesNotMatch(scanner,/fetch\s*\(|method:\s*['"]POST['"]|inventory\/movements/);
  assert.match(inventory,/OficinaBarcode\?\.attach/);
  assert.match(sales,/OficinaBarcode\?\.attach/);
  assert.match(sales,/updatePreview\(\)/);
  assert.match(markup,/\/barcode-scanner\.js/);
  assert.match(markup,/\/barcode-scanner\.css/);
  assert.match(pwa,/\/vendor\/quagga\.min\.js/);
  assert.match(pwa,/\/barcode-scanner\.js/);
  assert.match(readFileSync('public/vendor/LICENSE-quagga2','utf8'),/MIT/i);
});


test('P6: câmera não interpreta código depois que painel é removido durante decode',async()=>{
  let finish,stops=0;
  const stream={getTracks:()=>[{stop(){stops++}}]};
  class Detector{
    static async getSupportedFormats(){return ['ean_13']}
    async detect(){return new Promise(resolve=>{finish=resolve})}
  }
  const ui=setup({
    window:{BarcodeDetector:Detector},
    navigator:{mediaDevices:{getUserMedia:async()=>stream}}
  });
  const scans=[];
  ui.barcode.attach(ui.panel,async code=>{scans.push(code)});
  ui.elements.camera.handlers.click();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(typeof finish,'function');
  ui.panel.isConnected=false;
  finish([{rawValue:'7891234567895',format:'ean_13'}]);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(scans,[],'Não selecionar peça de outro modal ou página após fechar a câmera');
  assert.equal(stops,1);
});

test('P6: permissão tardia não inicia câmera se modal foi ocultado antes de resposta',async()=>{
  let allow,stops=0;
  const stream={getTracks:()=>[{stop(){stops++}}]};
  const permission=new Promise(resolve=>{allow=resolve});
  const ui=setup({
    navigator:{mediaDevices:{getUserMedia:()=>permission}}
  });
  ui.barcode.attach(ui.panel,async()=>{throw Error('Não chamar')});
  ui.elements.camera.handlers.click();
  ui.panel.isHidden=true;
  allow(stream);
  await ui.flush();
  assert.equal(stops,1);
  assert.equal(ui.elements.video.srcObject??null,null);
  assert.equal(ui.elements.video.hidden,true);
});

test('P6: SKU não encontrado permite nova tentativa e mantém código digitado',async()=>{
  const ui=setup();
  let calls=0;
  ui.barcode.attach(ui.panel,async()=>{
    calls++;
    return {state:'error',message:'Peça não localizada'};
  });
  ui.press('SKU-NAO-CADASTRADO');
  await ui.flush();
  assert.equal(ui.elements.status.textContent,'Peça não localizada');
  assert.equal(ui.elements.input.value,'SKU-NAO-CADASTRADO');
  ui.press('SKU-NAO-CADASTRADO');
  await ui.flush();
  assert.equal(calls,2);
});

test('P6: pesquisas sequenciais não compartilham resultado entre unidades',async()=>{
  const ui=setup();
  let activeUnit='A';
  const api=async path=>{
    assert.match(path,/search=SKU-123/);
    return {items:[{id:activeUnit==='A'?101:202,sku:'SKU-123'}],nextCursor:null};
  };
  const a=await ui.barcode.findPartBySku('SKU-123',api);
  activeUnit='B';
  const b=await ui.barcode.findPartBySku('SKU-123',api);
  assert.equal(a.id,101);
  assert.equal(b.id,202);
});

test('P6: entrada inválida não faz chamadas à API e mostra instrução de recuperação',async()=>{
  const ui=setup();
  let writes=0;
  ui.barcode.attach(ui.panel,async()=>{writes++});
  ui.press('  \n \t');
  await ui.flush();
  assert.equal(writes,0);
  assert.match(ui.elements.status.textContent,/Código vazio/i);
  assert.equal(ui.elements.camera.disabled,false);
});
