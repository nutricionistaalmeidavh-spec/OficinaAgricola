(function(root){
  'use strict';
  const CATALOG_URL='/carros3d/catalog.json';
  const PAGE_SIZE=24;
  const CATEGORIES={sports:'Esportivo',sedan:'Sedã',coupe:'Cupê',suv:'SUV',hatchback:'Hatch',wagon:'Perua',minivan:'Minivan',van:'Van',pickup:'Picape',utility:'Utilitário'};
  let catalogPromise=null;
  const browse={term:'',brand:'',category:'',page:1};

  function normalize(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g,' ');
  }
  function filter(cars,{term='',brand='',category=''}={}){
    const query=normalize(term);
    return cars.filter(car=>{
      if(brand&&car.brand!==brand)return false;
      if(category&&car.category!==category)return false;
      return !query||normalize([car.brand,car.model,car.credit?.sourceName].filter(Boolean).join(' ')).includes(query);
    });
  }
  function formatBytes(bytes){
    return (Number(bytes||0)/1048576).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' MB';
  }
  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,part=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[part]));
  }
  function categoryLabel(category){return CATEGORIES[category]||'Outros'}
  function thumbnail(category){
    const variants={
      pickup:'M62 84 L88 60 Q97 53 121 53 L165 53 L179 76 L206 76 L206 91 L300 91 L310 103 L310 131 L52 131 L52 104 Z',
      suv:'M50 109 L64 75 Q70 60 90 60 L226 60 Q248 61 260 79 L289 100 L309 107 L309 131 L49 131 Z',
      van:'M48 94 L64 58 Q71 48 84 48 L270 48 Q283 50 289 65 L300 94 L310 108 L310 132 L48 132 Z',
      minivan:'M48 104 L65 69 Q72 57 85 57 L223 57 Q256 58 275 82 L301 105 L310 132 L48 132 Z',
      sports:'M48 115 L83 108 L116 82 Q128 76 152 76 L224 76 Q249 82 270 108 L306 116 L312 131 L46 131 Z',
      coupe:'M47 113 L75 103 L103 78 Q121 66 141 66 L213 66 Q234 68 266 106 L310 115 L310 131 L47 131 Z',
      sedan:'M50 112 L76 102 L107 72 Q119 64 137 64 L216 64 Q237 66 265 102 L308 111 L308 131 L48 131 Z'
    };
    const path=variants[category]||variants.sedan;
    return '<svg class="ml-vehicle" viewBox="0 0 360 190" role="img" aria-label="Ilustração genérica da categoria; não é imagem do modelo real">'
      +'<ellipse cx="180" cy="147" rx="138" ry="10" fill="#0b1815" opacity=".13"/>'
      +'<path d="'+path+'" fill="currentColor" opacity=".92"/>'
      +'<path d="M109 78 L146 78 L163 101 L89 101 Z M168 78 L220 78 L246 101 L172 101 Z" fill="#e1f3f4" opacity=".65"/>'
      +'<path d="M54 127 L307 127" stroke="#122b27" stroke-width="3" opacity=".32"/>'
      +'<circle cx="101" cy="132" r="20" fill="#1b242b"/><circle cx="101" cy="132" r="9" fill="#b8c9ca"/>'
      +'<circle cx="263" cy="132" r="20" fill="#1b242b"/><circle cx="263" cy="132" r="9" fill="#b8c9ca"/>'
      +'<rect x="304" y="111" width="9" height="7" rx="2" fill="#f2b972"/>'
      +'</svg>';
  }
  async function loadCatalog(){
    if(!catalogPromise){
      catalogPromise=fetch(CATALOG_URL,{cache:'force-cache'})
        .then(response=>{if(!response.ok)throw new Error('Catálogo local indisponível');return response.json()})
        .then(data=>{
          if(!Array.isArray(data.cars)||!data.cars.length)throw new Error('Catálogo de veículos inválido');
          return data;
        }).catch(error=>{catalogPromise=null;throw error});
    }
    return catalogPromise;
  }
  function card(car){
    const id=escapeHtml(car.id),brand=escapeHtml(car.brand),model=escapeHtml(car.model);
    const category=escapeHtml(categoryLabel(car.category));
    return '<article class="ml-card">'
      +'<div class="ml-illustration ml-theme-'+(CATEGORIES[car.category]?car.category:'other')+'">'
      +'<span class="ml-preview-label">Ilustração da categoria</span>'+thumbnail(car.category)+'</div>'
      +'<div class="ml-card-body"><span class="ml-brand">'+brand+'</span><h3>'+model+'</h3>'
      +'<div class="ml-card-meta"><span>'+category+'</span><span>'+formatBytes(car.bytes)+'</span></div>'
      +'<button type="button" class="btn sm ml-detail" data-model-detail="'+id+'">Ver detalhes</button>'
      +'</div></article>';
  }
  function detail(car){
    const ref=String(car.credit?.sourceUrl||'');
    const safeUrl=/^https:\/\/sketchfab\.com\/3d-models\/[a-z0-9-]+$/i.test(ref)?ref:null;
    const licensed=String(car.credit?.license||'Não informada');
    const source=safeUrl?'<a href="'+escapeHtml(safeUrl)+'" target="_blank" rel="noopener noreferrer">Ver modelo original no Sketchfab (internet)</a>':'Fonte original não disponível';
    showModal('Modelo 3D — '+String(car.brand)+' '+String(car.model),
      '<div class="ml-detail-modal"><div class="ml-detail-picture ml-theme-'+(CATEGORIES[car.category]?car.category:'other')+'">'+thumbnail(car.category)+'</div>'
      +'<p><strong>Categoria:</strong> '+escapeHtml(categoryLabel(car.category))+'</p>'
      +'<p><strong>Tamanho do GLB:</strong> '+formatBytes(car.bytes)+'</p>'
      +'<p><strong>Licença:</strong> '+escapeHtml(licensed)+'</p>'
      +'<p><strong>Autor:</strong> '+escapeHtml(car.credit?.author||'Não informado')+'</p>'
      +'<p><strong>Fonte:</strong> '+source+'</p>'
      +'<p class="muted">O catálogo já funciona offline. Esta imagem é ilustrativa; a instalação seletiva e a visualização do GLB real serão entregues nas próximas fases.</p></div>');
  }
  function drawPage(cars){
    const results=filter(cars,browse);
    const pages=Math.max(1,Math.ceil(results.length/PAGE_SIZE));
    browse.page=Math.min(browse.page,pages);
    const start=(browse.page-1)*PAGE_SIZE;
    const grid=document.querySelector('#ml-grid');
    if(!grid)return;
    grid.innerHTML=results.length?results.slice(start,start+PAGE_SIZE).map(card).join(''):
      '<div class="ml-empty">Nenhum modelo encontrado. Experimente outra marca ou categoria.</div>';
    document.querySelector('#ml-count').textContent=results.length+' modelos encontrados';
    document.querySelector('#ml-pagination').textContent='Página '+browse.page+' de '+pages;
    document.querySelector('#ml-prev').disabled=browse.page<=1;
    document.querySelector('#ml-next').disabled=browse.page>=pages;
    grid.querySelectorAll('[data-model-detail]').forEach(button=>button.addEventListener('click',()=>{
      const car=cars.find(item=>item.id===button.dataset.modelDetail);
      if(car)detail(car);
    }));
  }
  async function render(){
    const catalog=await loadCatalog();
    if(typeof state!=='undefined'&&state.page!=='model-library')return;
    const cars=catalog.cars;
    const brands=[...new Set(cars.map(car=>car.brand))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    pageTitle('Biblioteca 3D','CATÁLOGO DE VEÍCULOS');
    setContent('<section class="ml-screen" aria-label="Biblioteca de modelos de veículos">'
      +'<div class="ml-hero"><div><span class="ml-kicker">ARTISYS · ACERVO 3D</span>'
      +'<h2>Encontre o veículo certo.</h2><p>Explore a biblioteca sem ocupar espaço com modelos ainda não escolhidos.</p></div>'
      +'<div class="ml-hero-stat"><strong>'+cars.length+'</strong><span>modelos catalogados</span></div></div>'
      +'<div class="ml-filters">'
      +'<label>Buscar veículo<input type="search" id="ml-search" placeholder="Ex.: Uno, Corolla, Hilux" autocomplete="off" value="'+escapeHtml(browse.term)+'"></label>'
      +'<label>Marca<select id="ml-brand"><option value="">Todas as marcas</option>'+brands.map(brand=>'<option value="'+escapeHtml(brand)+'"'+(browse.brand===brand?' selected':'')+'>'+escapeHtml(brand)+'</option>').join('')+'</select></label>'
      +'<label>Categoria<select id="ml-category"><option value="">Todas as categorias</option>'+Object.entries(CATEGORIES).map(([key,name])=>'<option value="'+key+'"'+(browse.category===key?' selected':'')+'>'+name+'</option>').join('')+'</select></label>'
      +'</div><div class="ml-result-bar"><strong id="ml-count" role="status" aria-live="polite"></strong>'
      +'<button id="ml-clear" type="button" class="btn sm">Limpar filtros</button></div>'
      +'<div id="ml-grid" class="ml-grid"></div>'
      +'<div class="ml-pagination"><button id="ml-prev" class="btn sm" type="button">Anterior</button>'
      +'<span id="ml-pagination" aria-live="polite"></span><button id="ml-next" class="btn sm" type="button">Próxima</button></div>'
      +'<div class="ml-footnote"><strong>Catálogo disponível offline.</strong> Os arquivos 3D não são baixados nesta fase. As miniaturas são ilustrações genéricas; instalação seletiva e vínculo automático com veículos e OS entram nas próximas fases. Créditos e licenças aparecem em cada detalhe.</div></section>');
    const update=(key,value)=>{browse[key]=value; browse.page=1;drawPage(cars)};
    document.querySelector('#ml-search').addEventListener('input',e=>update('term',e.target.value));
    document.querySelector('#ml-brand').addEventListener('change',e=>update('brand',e.target.value));
    document.querySelector('#ml-category').addEventListener('change',e=>update('category',e.target.value));
    document.querySelector('#ml-clear').addEventListener('click',()=>{
      browse.term='';browse.brand='';browse.category='';browse.page=1;
      document.querySelector('#ml-search').value='';
      document.querySelector('#ml-brand').value='';
      document.querySelector('#ml-category').value='';
      drawPage(cars);
    });
    document.querySelector('#ml-prev').addEventListener('click',()=>{browse.page--;drawPage(cars)});
    document.querySelector('#ml-next').addEventListener('click',()=>{browse.page++;drawPage(cars)});
    drawPage(cars);
  }
  root.OficinaModelLibrary={render,filter,formatBytes,categoryLabel};
})(window);
