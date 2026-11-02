const $=(s,root=document)=>root.querySelector(s); const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const state={token:localStorage.getItem('oficina_token')||'',user:null,page:'dashboard',pageReady:false,pageEpoch:0,pageController:null,modalToken:null,modalKey:null};
const dirtyInputs=new WeakSet();
// Reconciliação DOM local sem dependências externas. Somente nós diferentes mudam.
function nodeIdentity(node){
  if(node?.nodeType!==1)return null;
  for(const attr of ['id','data-os','data-sale','data-oa-os','data-edit-customer','data-edit-service','data-entry','data-history','data-check-position','data-edit-machine']){
    if(node.hasAttribute(attr))return attr+':'+node.getAttribute(attr);
  }
  return null;
}
function reconcileNode(current,incoming){
  if(current.nodeType!==incoming.nodeType||
    (current.nodeType===1&&current.tagName!==incoming.tagName)){
    current.replaceWith(incoming.cloneNode(true));
    return;
  }
  if(current.nodeType===3||current.nodeType===8){
    if(current.nodeValue!==incoming.nodeValue)current.nodeValue=incoming.nodeValue;
    return;
  }
  if(current.nodeType!==1)return;
  for(const attr of [...current.attributes]){
    if(attr.name==='data-user-dirty')continue;
    if(!incoming.hasAttribute(attr.name))current.removeAttribute(attr.name);
  }
  for(const attr of [...incoming.attributes]){
    if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
  }
  const control=['INPUT','TEXTAREA','SELECT'].includes(current.tagName);
  const preserve=control&&(document.activeElement===current||dirtyInputs.has(current));
  if(control&&!preserve&&current.value!==incoming.value)current.value=incoming.value;
  if(preserve)return;
  reconcileChildren(current,incoming);
}
function reconcileChildren(host,incoming){
  const nodes=[...incoming.childNodes];
  const scrollTop=host.scrollTop,scrollLeft=host.scrollLeft;
  for(let i=0;i<nodes.length;i++){
    const desired=nodes[i],key=nodeIdentity(desired);
    let present=host.childNodes[i]||null;
    if(key&&nodeIdentity(present)!==key){
      const match=[...host.childNodes].slice(i+1).find(x=>nodeIdentity(x)===key);
      if(match){host.insertBefore(match,present);present=match;}
      else if(present){
        // Uma entidade nova não pode sobrescrever DOM de outra entidade.
        host.insertBefore(desired.cloneNode(true),present);
        continue;
      }
    }
    if(!present){host.appendChild(desired.cloneNode(true));continue;}
    reconcileNode(present,desired);
  }
  while(host.childNodes.length>nodes.length)host.removeChild(host.lastChild);
  if(Number.isFinite(scrollTop))host.scrollTop=scrollTop;
  if(Number.isFinite(scrollLeft))host.scrollLeft=scrollLeft;
}
function trackDirtyInputs(host){
  if(!host?.addEventListener||host.__draftTracking)return;
  host.addEventListener('input',e=>{if(e.target)dirtyInputs.add(e.target)});
  host.__draftTracking=true;
}
const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
const dt=v=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
async function api(path,{method='GET',body,raw=false}={}){
  const headers={};if(state.token)headers.Authorization=`Bearer ${state.token}`;
  if(body!==undefined)headers['Content-Type']='application/json';
  const requester=window.localRuntime?.request||fetch;
  const isRead=method==='GET',epoch=state.pageEpoch;
  const signal=isRead?state.pageController?.signal:undefined;
  const res=await requester(path,{method,headers,signal,body:body===undefined?undefined:JSON.stringify(body)});
  if(isRead&&(signal?.aborted||epoch!==state.pageEpoch))throw new DOMException('Consulta obsoleta','AbortError');
  if(res.status===401){logout();throw new Error('Sessão expirada')}
  const text=await res.text();
  if(isRead&&(signal?.aborted||epoch!==state.pageEpoch))throw new DOMException('Consulta obsoleta','AbortError');
  if(!res.ok){let msg=text;try{msg=JSON.parse(text).error}catch{}throw new Error(msg||'Erro na operação')}
  return raw?text:(text?JSON.parse(text):null);
}
function toast(msg,error=false){const el=$('#toast');el.textContent=msg;el.className=`toast${error?' error':''}`;setTimeout(()=>el.classList.add('hidden'),2800)}
function showModal(title,html,onSubmit,{entityKey=null}={}){
  const dialog=$('#modal'),body=$('#modalBody'),heading=$('#modalTitle');
  const key=entityKey||title;
  const same=state.modalKey===key&&!dialog.classList.contains('hidden');
  heading.textContent=title;
  if(same&&body.childNodes?.length)renderRegion(body,html);
  else body.innerHTML=html;
  dialog.classList.remove('hidden');
  trackDirtyInputs(body);
  const token=Symbol('modal');
  state.modalToken=token;
  state.modalKey=key;
  const form=$('#modalBody form');
  if(form&&onSubmit)form.onsubmit=async e=>{
    e.preventDefault();
    const btn=$('button[type=submit]',form);if(btn)btn.disabled=true;
    try{
      await onSubmit(new FormData(form));
      // Um callback pode abrir outro modal; não fechar seu sucessor.
      if(state.modalToken===token)closeModal();
    }catch(err){toast(err.message,true)}
    finally{if(btn)btn.disabled=false}
  };
}
function closeModal(){state.modalToken=null;state.modalKey=null;$('#modal').classList.add('hidden');$('#modalBody').innerHTML=''}
function formObj(fd){return Object.fromEntries([...fd.entries()].map(([k,v])=>[k,typeof v==='string'?v.trim():v]))}
function badge(status){const cls=/PRONTA|ENTREGUE|APROVADA|PAGO/.test(status)?'green':/AGUARDANDO|ORCAMENTO|PARCIAL/.test(status)?'orange':/CANCELADA|REPROVADA/.test(status)?'red':'blue';return `<span class="pill ${cls}">${esc(status.replaceAll('_',' '))}</span>`}
function pageTitle(title,eyebrow='OFICINA'){ $('#pageTitle').textContent=title;$('#pageEyebrow').textContent=eyebrow }
function renderRegion(host,html){
  const template=document.createElement('template');
  template.innerHTML=html;
  reconcileChildren(host,template.content);
  trackDirtyInputs(host);
}
function setContent(html){
  const host=$('#content');
  if(!state.pageReady||!host.childNodes?.length)host.innerHTML=html;
  else renderRegion(host,html);
  trackDirtyInputs(host);
}

async function boot(){
  $('#today').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'});
  try{
    const setup=await api('/api/setup/status');
    if(setup.required){state.token='';localStorage.removeItem('oficina_token');return showSetup()}
  }catch{ /* The login view will display server errors if offline. */ }
  if(!state.token)return showLogin();
  try{state.user=await api('/api/auth/me');showApp();await navigate('dashboard')}catch{showLogin()}
}
function showSetup(){
  $('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden');
  $('#loginForm').classList.add('hidden');$('#setupForm').classList.remove('hidden');
}
function showLogin(){
  $('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden');
  $('#setupForm').classList.add('hidden');$('#loginForm').classList.remove('hidden');
}
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#userName').textContent=state.user.name;$('#userRole').textContent=state.user.role;$('#avatar').textContent=state.user.name[0]?.toUpperCase()||'A'}
function logout(){state.pageController?.abort();state.pageEpoch++;state.pageReady=false;state.token='';state.user=null;localStorage.removeItem('oficina_token');showLogin()}

function pageRenderer(page){
  const dashboard=typeof renderDashboard==='function'?renderDashboard:async()=>{};
  return ({
    dashboard,customers:renderCustomers,machines:renderMachines,
    'work-orders':renderWorkOrders,inventory:renderInventory,schedule:renderSchedule,
    finance:renderFinance,reports:renderReports,technicians:renderTechnicians,
    settings:renderSettings,services:renderServices,sales:renderSales
  })[page]||dashboard;
}
let refreshPromise=null,refreshQueued=false;
// Consolida concorrência numa projeção por página, sem sobrescrever requests recentes.
async function refreshCurrentPage(){
  if(!state.pageReady)return;
  if(refreshPromise){refreshQueued=true;return refreshPromise}
  const epoch=state.pageEpoch,active=state.page;
  refreshPromise=(async()=>{
    do{
      refreshQueued=false;
      if(epoch!==state.pageEpoch||active!==state.page)return;
      await pageRenderer(active)();
    }while(refreshQueued&&epoch===state.pageEpoch);
  })();
  try{await refreshPromise}
  catch(error){if(epoch===state.pageEpoch&&error?.name!=='AbortError')toast(error.message,true)}
  finally{refreshPromise=null;refreshQueued=false}
}
async function navigate(page,{force=false}={}){
  if(state.page===page&&state.pageReady&&!force)return;
  state.pageController?.abort();
  state.pageController=new AbortController();
  const epoch=++state.pageEpoch;
  state.pageReady=false;
  state.page=page;
  $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  setContent('<div class="card"><div class="empty">Carregando…</div></div>');
  try{
    await pageRenderer(page)();
    if(epoch===state.pageEpoch)state.pageReady=true;
  }catch(err){
    if(epoch!==state.pageEpoch||err.name==='AbortError')return;
    setContent(`<div class="card"><div class="empty error">${esc(err.message)}</div></div>`);
    toast(err.message,true);
  }
}

function stat(label,value,cls=''){return `<div class="stat"><small>${label}</small><strong class="${cls}">${value}</strong></div>`}
