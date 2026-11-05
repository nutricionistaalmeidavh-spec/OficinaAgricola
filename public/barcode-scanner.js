(function oficinaBarcodeScanner(){
  'use strict';
  const CAMERA_FORMATS=['ean_13','ean_8','code_128','code_39','upc_a'];
  let stopCurrentCamera=null;

  function normalizeCode(value){
    const code=String(value??'').replace(/[\x00-\x1f\x7f]/g,'').trim();
    if(!code)throw new Error('Código vazio. Escaneie novamente ou digite o código.');
    if(code.length>128)throw new Error('Código excede 128 caracteres.');
    return code;
  }

  function createDeduper(interval=800){
    let lastCode='',lastAt=-Infinity;
    const dedupe=(code,at=Date.now())=>{
      if(code===lastCode && at-lastAt<interval)return false;
      lastCode=code;lastAt=at;return true;
    };
    dedupe.reset=()=>{lastCode='';lastAt=-Infinity;};
    return dedupe;
  }

  async function findPartBySku(code,fetchPage,{includeInactive=false}={}){
    const term=normalizeCode(code);
    if(typeof fetchPage!=='function')throw new Error('Busca de peças indisponível.');
    let cursor=null;
    const visited=new Set();
    for(let pageNumber=0;pageNumber<100;pageNumber++){
      const params=new URLSearchParams({search:term.slice(0,100),limit:'50'});
      if(includeInactive)params.set('includeInactive','1');
      if(cursor)params.set('cursor',cursor);
      const page=await fetchPage('/api/parts/page?'+params.toString());
      const found=(page.items||[]).find(item=>String(item.sku??'').trim()===term);
      if(found)return found;
      if(!page.nextCursor)return null;
      cursor=String(page.nextCursor);
      if(visited.has(cursor))throw new Error('Paginação de peças inválida.');
      visited.add(cursor);
    }
    throw new Error('A busca excedeu o limite seguro. Pesquise a peça pelo SKU.');
  }

  function markup(context=''){
    return `<section class="barcode-panel" data-barcode-panel data-context="${context==='sale'?'sale':'inventory'}" aria-label="Leitura de código de barras">
      <div class="barcode-panel-head"><strong>Leitor de código de barras</strong><small>USB/Bluetooth · câmera · digitação</small></div>
      <div class="barcode-panel-controls">
        <label>Escaneie ou digite o código
          <input data-barcode-input type="text" maxlength="128" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Aponte o leitor e pressione Enter" aria-label="Código de barras ou SKU">
        </label>
        <button type="button" class="btn soft" data-barcode-camera>Usar câmera</button>
      </div>
      <video data-barcode-video playsinline muted autoplay hidden aria-label="Visualização da câmera para leitura"></video>
      <button type="button" class="btn sm" data-barcode-stop hidden>Fechar câmera</button>
      <p data-barcode-status class="barcode-panel-status muted" role="status" aria-live="polite">A leitura identifica a peça. Nenhuma movimentação ou venda é feita automaticamente.</p>
    </section>`;
  }

  function messageForCameraError(error){
    if(error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError')
      return 'Câmera não autorizada. Permita o acesso no navegador ou digite o código.';
    if(error?.name==='NotFoundError'||error?.name==='OverconstrainedError')
      return 'Nenhuma câmera disponível. Use o leitor físico ou digite o código.';
    if(error?.name==='NotReadableError')
      return 'Câmera ocupada por outro aplicativo. Feche-o e tente novamente.';
    return 'Não foi possível iniciar a leitura pela câmera. Use o leitor ou digite o código.';
  }

  function attach(panel,onScan){
    if(!panel||typeof onScan!=='function')return ()=>{};
    if(typeof stopCurrentCamera==='function')stopCurrentCamera();
    const input=panel.querySelector('[data-barcode-input]');
    const camera=panel.querySelector('[data-barcode-camera]');
    const stopButton=panel.querySelector('[data-barcode-stop]');
    const video=panel.querySelector('[data-barcode-video]');
    const status=panel.querySelector('[data-barcode-status]');
    if(!input||!camera||!stopButton||!video||!status)return ()=>{};
    const accept=createDeduper();
    let stream=null,timer=null,generation=0,busy=false,failures=0;
    let detector=null;
    const report=(message,kind='')=>{
      if(!panel.isConnected)return;
      status.textContent=message;
      panel.dataset.scanState=kind;
    };
    const releaseStream=source=>{for(const track of source?.getTracks?.()||[])track.stop();};
    const stopCamera=()=>{
      generation++;
      if(timer!==null){clearTimeout(timer);timer=null;}
      releaseStream(stream);stream=null;detector=null;
      if(video.srcObject){video.pause();video.srcObject=null;}
      video.hidden=true;stopButton.hidden=true;camera.disabled=false;
    };
    stopCurrentCamera=stopCamera;

    async function receive(value,source){
      let code;
      try{code=normalizeCode(value);}catch(error){report(error.message,'error');return;}
      if(busy||!accept(code))return;
      busy=true;input.disabled=true;
      report('Pesquisando '+code+'…','pending');
      try{
        const result=await onScan(code,{source});
        const message=typeof result==='string'?result:result?.message;
        const status=typeof result==='object'&&['success','warning','error'].includes(result?.state)?result.state:'success';
        report(message||'Código '+code+' capturado.',status);
        if(status==='error')accept.reset();
        else input.value='';
      }catch(error){
        accept.reset();
        report('Não foi possível consultar '+code+': '+(error?.message||'tente novamente')+'.','error');
      }finally{
        busy=false;input.disabled=false;
      }
    }

    input.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing)return;
      event.preventDefault();
      void receive(input.value,'leitor-ou-digitacao');
    });
    stopButton.addEventListener('click',()=>{
      stopCamera();report('Leitura por câmera encerrada. Você pode escanear ou digitar.');input.focus();
    });
    camera.addEventListener('click',()=>void startCamera());

    async function makeDetector(){
      const native=window.BarcodeDetector;
      if(typeof native==='function'){
        try{
          const supported=await native.getSupportedFormats?.();
          if(!Array.isArray(supported)||CAMERA_FORMATS.some(format=>supported.includes(format)))
            return new native({formats:Array.isArray(supported)?CAMERA_FORMATS.filter(format=>supported.includes(format)):CAMERA_FORMATS});
        }catch{/* Usar alternativa local gratuita. */}
      }
      if(!window.Quagga){
        await new Promise((resolve,reject)=>{
          const script=document.createElement('script');
          script.src='/vendor/quagga.min.js';
          script.async=true;
          script.onload=()=>window.Quagga?resolve():reject(new Error('Biblioteca de câmera indisponível'));
          script.onerror=()=>reject(new Error('Biblioteca de câmera local não encontrada'));
          document.head.appendChild(script);
        });
      }
      const canvas=document.createElement('canvas');
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)throw new Error('Canvas indisponível para leitura');
      return {detect(source){
        const width=source.videoWidth||source.width,height=source.videoHeight||source.height;
        if(!width||!height)return Promise.resolve([]);
        const ratio=Math.min(1,640/width);
        canvas.width=Math.max(1,Math.round(width*ratio));
        canvas.height=Math.max(1,Math.round(height*ratio));
        context.drawImage(source,0,0,canvas.width,canvas.height);
        return new Promise((resolve,reject)=>{
          let finished=false;
          const timeout=setTimeout(()=>finish(new Error('Tempo excedido na leitura.')),5000);
          function finish(error,result){
            if(finished)return;finished=true;clearTimeout(timeout);
            if(error)return reject(error);
            const item=result?.codeResult;
            resolve(item?.code?[{rawValue:item.code,format:item.format}]:[]);
          }
          try{
            window.Quagga.decodeSingle({
              src:canvas.toDataURL('image/jpeg',0.85),
              numOfWorkers:0,locate:true,
              inputStream:{size:640},
              decoder:{readers:['ean_reader','ean_8_reader','code_128_reader','code_39_reader','upc_reader']}
            },result=>finish(null,result));
          }catch(error){finish(error);}
        });
      }};
    }

    async function scanFrame(expectedGeneration){
      if(expectedGeneration!==generation||!stream||!panel.isConnected||panel.closest?.('.modal-backdrop.hidden')){
        stopCamera();return;
      }
      try{
        if(video.readyState>=2){
          const results=await detector.detect(video);
          if(expectedGeneration!==generation)return;
          const found=results?.find(item=>item.rawValue&&CAMERA_FORMATS.includes(item.format));
          if(found){
            stopCamera();
            await receive(found.rawValue,'camera');
            return;
          }
        }
        failures=0;
      }catch(error){
        if(++failures>=5){
          stopCamera();
          report('Não foi possível interpretar a câmera. Reposicione o código ou digite-o.','error');
          return;
        }
      }
      if(expectedGeneration===generation)timer=setTimeout(()=>void scanFrame(expectedGeneration),230);
    }

    async function startCamera(){
      if(stream||camera.disabled)return;
      if(!navigator.mediaDevices?.getUserMedia){
        report('A câmera requer HTTPS (ou localhost) e um navegador compatível. Use o leitor ou digite o código.','error');
        return;
      }
      camera.disabled=true;
      report('Solicitando permissão para acessar a câmera…','pending');
      const sequence=++generation;
      let acquired=null;
      try{
        acquired=await navigator.mediaDevices.getUserMedia({
          audio:false,video:{facingMode:{ideal:'environment'}}
        });
        if(sequence!==generation||!panel.isConnected){releaseStream(acquired);return;}
        stream=acquired;video.srcObject=stream;video.hidden=false;stopButton.hidden=false;
        await video.play();
        detector=await makeDetector();
        if(sequence!==generation)return;
        failures=0;
        report('Aponte a câmera para o código de barras.','scanning');
        void scanFrame(sequence);
      }catch(error){
        if(acquired && acquired!==stream)releaseStream(acquired);
        stopCamera();
        report(messageForCameraError(error),'error');
      }
    }
    return stopCamera;
  }

  window.OficinaBarcode={normalizeCode,createDeduper,findPartBySku,markup,attach,
    stopCamera(){if(typeof stopCurrentCamera==='function')stopCurrentCamera();}};
})();
