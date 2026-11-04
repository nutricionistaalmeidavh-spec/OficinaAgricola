(function(root){
  'use strict';
  let topPromise=null;
  const TOP_URL='/carros3d/top20.json';
  const safeLink=url=>/^https:\/\/sketchfab\.com\/3d-models\/[a-z0-9-]+$/i.test(url||'')?url:null;
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&#39;'}[c]));
  const formatMB=size=>(Number(size||0)/1048576).toLocaleString('pt-BR',{maximumFractionDigits:2})+' MB';

  async function load(){
    if(!topPromise){
      topPromise=fetch(TOP_URL,{cache:'force-cache'}).then(async r=>{
        if(!r.ok)throw new Error('Top 20 de veículos indisponível');
        const catalog=await r.json();
        if(!Array.isArray(catalog.models)||catalog.models.length!==20)throw new Error('Top 20 inválido');
        return catalog;
      }).catch(error=>{topPromise=null;throw error});
    }
    const [catalog,statusRes]=await Promise.all([topPromise,fetch('/api/models3d/status',{credentials:'same-origin',cache:'no-store'})]);
    if(!statusRes.ok)throw new Error('Não foi possível consultar modelos 3D instalados');
    const status=await statusRes.json();
    return {top20:catalog.models,installed:new Map((status.models||[]).map(x=>[x.id,x.installed||{}]))};
  }

  function enrich(catalogCars,{top20,installed}){
    const fromCatalog=new Map(catalogCars.map(car=>[car.id,car]));
    const ranks=top20.map(entry=>{
      const base=fromCatalog.get(entry.id)||{};
      return {
        ...base,...entry,
        credit:entry.credit||base.credit||null,
        bytes:entry.variants?.original?.bytes||0,
        _top:entry,
        _installedVariants:installed.get(entry.id)||{}
      };
    });
    const used=new Set(ranks.map(car=>car.id));
    return [...ranks,...catalogCars.filter(car=>!used.has(car.id))];
  }

  function thumbnail(car,fallbackSvg){
    const preview=car._top?.thumbnail;
    if(!preview||!/^\/carros3d\/thumbs\/[a-z0-9-]+\.png$/.test(preview))
      return fallbackSvg;
    return '<img class="ml-thumb" loading="lazy" alt="Miniatura real do GLB '+escapeHtml(car.brand)+' '+escapeHtml(car.model)+'; revisão pendente" src="'+preview+'">';
  }
  function modelBadge(car){
    if(!car._top)return 'Não curado';
    if(car._top.status==='blocked')return 'Sem GLB confiável';
    if(Object.values(car._installedVariants||{}).some(Boolean))return 'Instalado · Offline';
    return '3D disponível para instalar';
  }

  async function open(car,{showModal,onInstalled,isAdmin=false}){
    const target=car._top;
    if(!target)return;
    const variants=Object.keys(target.variants||{});
    const first=variants.includes('restored')?'restored':'original';
    const blocked=target.status==='blocked';
    const source=safeLink(target.credit?.sourceUrl);
    const credits=target.credit?
      '<p><strong>Autor:</strong> '+escapeHtml(target.credit.author||'Não informado')+
      ' · <strong>Licença:</strong> '+escapeHtml(target.credit.license||'Não informada')+'</p>':'';
    const notes=[...(target.notes||[])];
    if(target.variants?.restored)notes.push('Versão restaurada experimental; não corrige necessariamente rodas ou outras malhas ausentes');
    notes.push('Modelo ainda não homologado para identificação de geração e inspeção de peças');
    const warning=notes.map(note=>'<li>'+escapeHtml(note)+'</li>').join('');
    const stage=blocked?'<div class="ml-not-available">'+escapeHtml(target.blockReason||'Modelo não identificado no acervo')+'</div>':
      '<div id="ml-viewer-stage" class="ml-viewer-stage" role="img" aria-label="Visualização tridimensional interativa do veículo"><div class="ml-viewer-empty">Baixe ou importe o GLB para visualizar este veículo em 3D.</div></div>';
    showModal('Veículo 3D · '+target.brand+' '+target.model,
      '<section class="ml-viewer-panel"><div class="ml-viewer-meta"><span>Top '+target.rank+' da frota brasileira</span>'
      +'<span>'+escapeHtml(target.review_status==='PENDENTE_REVISAO_VISUAL'?'Em curadoria':'Revisado')+'</span></div>'
      +stage+(blocked?'':[
        '<div class="ml-viewer-actions">',
        '<label class="ml-variant-label">Versão<select id="ml-variant">',
        variants.map(v=>'<option value="'+v+'"'+(v===first?' selected':'')+'>'+(
          v==='restored'?'Materiais restaurados (experimental)':'Original')+'</option>').join(''),
        '</select></label>',
        '<button type="button" class="btn" id="ml-view-start">Abrir visualização 3D</button>',
        (isAdmin?'<button type="button" class="btn" id="ml-install">Baixar modelo</button><label class="btn ml-import-btn">Importar GLB local<input type="file" id="ml-import-file" accept=".glb,model/gltf-binary"></label>':''),
        (variants.includes('restored')?'<label class="ml-color-label">Cor (prévia)<input type="color" id="ml-paint" value="#467D8C" aria-label="Alterar cor da carroceria apenas na visualização"></label>':''),
        '</div><div id="ml-viewer-message" role="status" aria-live="polite" class="ml-viewer-message"></div>'
      ].join(''))
      +'<div class="ml-viewer-notes"><h4>Curadoria e licenças</h4><ul>'+warning+'</ul>'
      +credits+(source?'<p><a href="'+escapeHtml(source)+'" rel="noopener noreferrer" target="_blank">Ver origem 3D no Sketchfab</a></p>':'')
      +'<p>Os downloads são opcionais e armazenados no servidor da oficina. Depois de instalado, o modelo funciona offline em computadores e celulares conectados ao servidor.</p></div></section>',
      undefined,{entityKey:'library3d:'+target.id});
    if(blocked)return;
    const select=document.querySelector('#ml-variant');
    const openBtn=document.querySelector('#ml-view-start');
    const installBtn=document.querySelector('#ml-install');
    const localFile=document.querySelector('#ml-import-file');
    const colorInput=document.querySelector('#ml-paint');
    const message=document.querySelector('#ml-viewer-message');
    const stageElement=document.querySelector('#ml-viewer-stage');
    let variant=select.value,viewer=null;
    let installed={...(car._installedVariants||{})},busy=false;
    function updateControls({preserveMessage=false}={}){
      variant=select.value;
      const ready=Boolean(installed[variant]);
      openBtn.disabled=!ready||busy;
      if(installBtn){
        installBtn.disabled=busy||ready;
        installBtn.textContent=ready?'Modelo instalado':'Baixar '+formatMB(target.variants[variant]?.bytes);
      }
      if(colorInput)colorInput.disabled=!ready||busy;
      if(!busy&&!preserveMessage&&!stageElement.querySelector('canvas'))message.textContent=ready?'Modelo disponível offline neste servidor':'Modelo ainda não instalado neste servidor';
    }
    async function preview(){
      if(!installed[variant]){message.textContent='Instale ou importe esta versão antes de visualizar.';return}
      if(busy){message.textContent='A operação anterior ainda está sendo concluída.';return}
      const targetVariant=variant;
      busy=true;
      stageElement.dataset.viewerState='loading';
      updateControls();
      message.textContent='Preparando visualização 3D...';
      try{
        const mod=await import('/model-viewer.js');
        if(!stageElement.isConnected)return;
        viewer=await mod.mountViewer({id:target.id,variant:targetVariant,element:stageElement,statusElement:message});
        stageElement.dataset.viewerState=viewer?'ready':'cancelled';
      }catch(error){
        if(stageElement.isConnected){
          stageElement.dataset.viewerState='error';
          message.textContent='Falha na visualização: '+(error.message||error);
        }
      }finally{busy=false;if(stageElement.isConnected)updateControls({preserveMessage:true})}
    }
    select.addEventListener('change',()=>{
      // Limpeza síncrona: um import() pendente poderia fechar a nova visualização.
      viewer?.dispose?.();viewer=null;
      stageElement.dataset.viewerState='idle';
      stageElement.replaceChildren();
      const blank=document.createElement('div');
      blank.className='ml-viewer-empty';blank.textContent='Escolha a opção para abrir esta versão em 3D.';
      stageElement.appendChild(blank);
      updateControls();
    });
    openBtn.addEventListener('click',()=>{
      stageElement.dataset.viewerClicked='true';
      void preview();
    });
    if(installBtn){
      installBtn.addEventListener('click',async()=>{
        if(busy)return;
        busy=true;updateControls();
        message.textContent='Baixando o GLB e verificando a integridade SHA-256...';
        try{
          const response=await fetch('/api/models3d/install/'+target.id+'/'+select.value,{
            method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'
          });
          const payload=await response.json();
          if(!response.ok)throw new Error(payload.error||'Falha no download');
          installed[select.value]=true;
          car._installedVariants=installed;
          onInstalled?.();
          message.textContent='Modelo instalado com sucesso, pronto para uso offline';
        }catch(error){message.textContent='Falha na instalação: '+(error.message||error)}
        finally{busy=false;updateControls()}
      });
    }
    if(localFile){
      localFile.addEventListener('change',async()=>{
        if(busy||!localFile.files?.length)return;
        const file=localFile.files[0];
        if(file.size>25*1024*1024){message.textContent='Arquivo superior ao limite de 25 MB';localFile.value='';return}
        busy=true;updateControls();
        message.textContent='Verificando GLB local contra a versão do catálogo...';
        try{
          const response=await fetch('/api/models3d/import/'+target.id+'/'+select.value,{
            method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:file
          });
          const payload=await response.json();
          if(!response.ok)throw new Error(payload.error||'Arquivo incompatível');
          installed[select.value]=true;car._installedVariants=installed;onInstalled?.();
          message.textContent='GLB importado e verificado, disponível offline';
        }catch(error){message.textContent='Falha na importação: '+(error.message||error)}
        finally{busy=false;localFile.value='';updateControls()}
      });
    }
    colorInput?.addEventListener('input',()=>viewer?.paint?.(colorInput.value));
    updateControls();
    if(installed[variant])void preview();
  }

  root.OficinaModel3D={load,enrich,thumbnail,modelBadge,open};
})(window);
