// Busca incremental: não descarrega catálogos inteiros em formulários.
// Usa os endpoints paginados já existentes e mantém a chave canônica da entidade.
function pagedLookupUrl(resource,{search='',customerId=null,limit=30}={}){
  if(!['customers','machines','parts'].includes(resource))throw new Error('Recurso de busca inválido');
  const query=new URLSearchParams({limit:String(Math.min(50,Math.max(1,limit))),search:String(search).slice(0,100)});
  if(resource==='machines'&&customerId!==null&&customerId!==''){
    if(!Number.isSafeInteger(Number(customerId))||Number(customerId)<=0)
      throw new Error('Cliente inválido para busca');
    query.set('customerId',String(customerId));
  }
  return '/api/'+resource+'/page?'+query.toString();
}

function attachPagedLookup(select,{resource,placeholder='Pesquisar por nome...',label,
  selected=null,customerId=()=>null,empty='Selecione'}={}){
  if(!select)throw new Error('Seletor ausente');
  const search=document.createElement('input');
  search.type='search';search.autocomplete='off';search.placeholder=placeholder;
  search.setAttribute('aria-label','Pesquisar '+(label||resource));
  search.className='paged-lookup-search';
  select.before(search);
  let retained=selected?.id?{id:String(selected.id),label:String(selected.label||'Registro selecionado')}:null;
  let generation=0,debounce=null;
  function render(items=[],message=empty){
    const prev=retained?.id||select.value||'';
    select.replaceChildren();
    const blank=new Option(message,'');select.add(blank);
    const combined=[...(retained?[retained]:[]),...items.map(item=>({
      id:String(item.id),
      label: resource==='customers'?item.name:resource==='parts'?item.sku+' — '+item.description:
        [item.brand,item.model,item.type,item.license_plate].filter(Boolean).join(' ')
    }))];
    const seen=new Set();
    for(const item of combined){
      if(!item.id||seen.has(item.id))continue;
      seen.add(item.id);
      select.add(new Option(item.label,item.id));
    }
    select.value=seen.has(prev)?prev:'';
  }
  async function load(term=search.value){
    const serial=++generation;
    const owner=resource==='machines'?customerId():null;
    if(resource==='machines'&&!owner){render([],'Selecione primeiro o cliente');return;}
    try{
      const page=await api(pagedLookupUrl(resource,{search:term,customerId:owner}));
      if(serial!==generation||!select.isConnected)return;
      render(page.items||[],page.total===0?'Nenhum resultado':empty);
    }catch(error){
      if(serial!==generation||!select.isConnected)return;
      render([],'Falha ao pesquisar — tente novamente');
    }
  }
  select.addEventListener('change',()=>{
    const option=select.selectedOptions[0];
    retained=select.value?{id:select.value,label:option.textContent}:null;
  });
  search.addEventListener('input',()=>{
    clearTimeout(debounce);
    debounce=setTimeout(()=>void load(),220);
  });
  search.addEventListener('focus',()=>{if(select.options.length<2)void load();});
  render();
  void load('');
  return {
    reload:()=>load(''),
    clear:()=>{
      generation++;clearTimeout(debounce);retained=null;search.value='';render();
    }
  };
}
