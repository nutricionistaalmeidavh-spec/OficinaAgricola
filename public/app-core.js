const $=(s,root=document)=>root.querySelector(s); const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const state={token:localStorage.getItem('oficina_token')||'',user:null,page:'dashboard',pageReady:false,pageEpoch:0,pageController:null,modalToken:null,modalKey:null};
const dirtyInputs=new WeakSet();
// ID + usuário evita reenviar comandos para outra conta quando um banco for recriado.
const currentCommandOwner=()=>state.user?
  String(state.user.id)+':'+String(state.user.username||''):null;
const commandQueue=window.OficinaCommands?.createQueue({
  send:({path,method,body})=>{
    // Autorizações nunca entram no IndexedDB; cada envio usa a sessão atual.
    const headers={'Content-Type':'application/json'};
    if(state.token)headers.Authorization='Bearer '+state.token;
    const transport=window.localRuntime?.request||fetch;
    return transport(path,{method,headers,body:JSON.stringify(body)});
  },
  checkStatus:async record=>{
    const headers={};
    if(state.token)headers.Authorization='Bearer '+state.token;
    const qs=new URLSearchParams({method:record.method,path:record.path});
    const url='/api/commands/'+encodeURIComponent(record.body.requestId)+'/status?'+qs;
    const transport=window.localRuntime?.request||fetch;
    const response=await transport(url,{headers,cache:'no-store'});
    if(response.status===401||response.status===403)return 'AUTH_REQUIRED';
    if(!response.ok)throw new Error('Não foi possível consultar a confirmação da operação');
    const receipt=await response.json();
    return receipt.state;
  }
});
async function updatePendingCommands(){
  const button=$('#pendingCommands');
  if(!button)return;
  if(!commandQueue||!state.user){button.classList.add('hidden');return}
  const owner=currentCommandOwner();
  try{
    const pending=await commandQueue.list(owner);
    if(!state.user||currentCommandOwner()!==owner)return;
    const count=pending.length;
    button.classList.toggle('hidden',count===0);
    button.textContent=count===0?'':count===1
      ?'1 operação aguardando confirmação · Ver detalhes'
      :count+' operações aguardando confirmação · Ver detalhes';
  }catch(error){
    // Erro de armazenamento não pode ser tratado como operação confirmada.
    button.classList.remove('hidden');
    button.textContent='Verificar armazenamento local de operações';
    button.title=error.message;
  }
}
function commandLabel(record){
  const p=record.path||'';
  if(p.includes('/receipts'))return 'Recebimento da OS';
  if(p.includes('/parts')||p.includes('/inventory'))return 'Movimentação de estoque';
  if(p.includes('/expenses'))return 'Despesa';
  if(p.includes('/cash'))return 'Movimentação de caixa';
  if(p.includes('/sales'))return 'Venda';
  if(p.includes('/work-orders'))return 'Ordem de serviço';
  if(p.includes('/machines'))return 'Equipamento';
  if(p.includes('/customers'))return 'Cliente';
  if(p.includes('/schedule'))return 'Agenda';
  return 'Operação do sistema';
}
async function openPendingCommands(){
  if(!commandQueue||!state.user)return;
  const owner=currentCommandOwner();
  const entries=(await commandQueue.list(owner)).sort((a,b)=>a.createdAt-b.createdAt);
  const rows=entries.map(record=>{
    const label=commandLabel(record);
    const date=new Date(record.createdAt).toLocaleString('pt-BR');
    const details=record.body?.name||record.body?.description||'';
    const requiresReview=record.autoReplay===false;
    const status=record.status==='AGUARDANDO_LOGIN'?'Aguardando autenticação':
      record.status==='INCERTO'?'Confirmação incerta':'Enviado ao servidor';
    return `<article class="pending-item">
      <div><strong>${esc(label)}</strong>
        <small>${esc(date)} · ${esc(status)}</small>
        ${details?`<p>${esc(String(details).slice(0,100))}</p>`:''}
        ${requiresReview?'<small class="pending-warning">Reenvio exige conferência manual</small>':''}
      </div></article>`;
  }).join('');
  showModal('Operações aguardando confirmação',`
    <section class="pending-list" aria-label="Operações não confirmadas">
      <p>Antes de reenviar, o sistema consulta se cada operação já foi registrada.
        Não é necessário informar identificadores técnicos.</p>
      ${rows||'<p>Nenhuma operação pendente.</p>'}
      <div class="action-row">
        <button id="retryPendingAll" class="btn primary" type="button"
          ${!entries.length?'disabled':''}>Conferir e tentar novamente</button>
        <button id="closePending" class="btn" type="button">Fechar</button>
      </div>
    </section>`,null,{entityKey:'pending-queue'});
  $('#retryPendingAll').onclick=async e=>{
    e.currentTarget.disabled=true;
    await resumePendingCommands(true);
    if(state.modalKey==='pending-queue')closeModal();
  };
  $('#closePending').onclick=closeModal;
}
async function resumePendingCommands(manual=false){
  if(!commandQueue||!state.user)return;
  const owner=currentCommandOwner();
  try{
    const confirmed=await commandQueue.replay(owner,{manual});
    if(!state.user||currentCommandOwner()!==owner)return;
    if(confirmed>0){
      toast(confirmed===1?'Operação pendente confirmada':confirmed+' operações confirmadas');
      await refreshCurrentPage();
    }else if(manual){
      const left=await commandQueue.list(owner);
      if(left.length)toast('Não foi possível confirmar todas as operações. Tente novamente quando o servidor voltar.',true);
    }
  }catch(error){if(manual)toast(error.message,true)}
  finally{await updatePendingCommands()}
}
commandQueue?.bus.on('pending',()=>void updatePendingCommands());
commandQueue?.bus.on('confirmed',()=>void updatePendingCommands());
commandQueue?.bus.on('rejected',()=>void updatePendingCommands());
window.addEventListener?.('online',()=>void resumePendingCommands());
window.addEventListener?.('oficina:server-status',e=>{
  if(e.detail?.available)void resumePendingCommands();
});

function newCommandId(){
  return globalThis.crypto?.randomUUID?.()||
    `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
// Reconciliação DOM local sem dependências externas. Somente nós diferentes mudam.
function nodeIdentity(node){
  if(node?.nodeType!==1)return null;
  const markers=['id','data-os','data-sale','data-oa-os','data-edit-customer',
    'data-edit-service','data-entry','data-history','data-check-position','data-edit-machine'];
  for(const attr of markers){
    if(node.hasAttribute(attr))return attr+':'+node.getAttribute(attr);
  }
  // Linhas de tabelas também precisam identidade estável quando a lista muda de ordem.
  if(node.tagName==='TR'){
    const child=node.querySelector?.('[data-edit-customer],[data-edit-service],[data-entry],[data-sale],[data-history]');
    if(child){
      for(const attr of markers)if(child.hasAttribute(attr))
        return 'row:'+attr+':'+child.getAttribute(attr);
    }
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
  const res=!isRead&&!raw&&commandQueue&&state.user
    ?await commandQueue.execute({ownerId:currentCommandOwner(),path,method,body:body||{}})
    :await requester(path,{method,headers,signal,body:body===undefined?undefined:JSON.stringify(body)});
  if(isRead&&(signal?.aborted||epoch!==state.pageEpoch))throw new DOMException('Consulta obsoleta','AbortError');
  if(res.status===401){logout();throw new Error('Sessão expirada')}
  const text=await res.text();
  if(isRead&&(signal?.aborted||epoch!==state.pageEpoch))throw new DOMException('Consulta obsoleta','AbortError');
  if(!res.ok){let msg=text;try{msg=JSON.parse(text).error}catch{}throw new Error(msg||'Erro na operação')}
  return raw?text:(text?JSON.parse(text):null);
}
let toastTimer=null;
function toast(msg,error=false){
  const el=$('#toast');
  clearTimeout(toastTimer);
  el.textContent=msg;el.className=`toast${error?' error':''}`;
  toastTimer=setTimeout(()=>el.classList.add('hidden'),error?8000:4500);
}
let modalSession=null;
function modalFocusables(){
  const root=$('#modalDiscardPrompt')||$('#modal .modal-card');
  return $$('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',root)
    .filter(el=>el.getClientRects().length&&!el.closest('[inert]'));
}
function syncModalViewport(){
  const dialog=$('#modal');
  const viewport=window.visualViewport;
  if(!viewport||!dialog?.style)return;
  dialog.style.setProperty('--modal-viewport-height',viewport.height+'px');
  dialog.style.setProperty('--modal-viewport-top',viewport.offsetTop+'px');
}
function beginModalSession(){
  if(modalSession)return;
  modalSession={trigger:document.activeElement,background:[]};
  for(const el of [$('#appView'),$('#loginView')]){
    modalSession.background.push([el,el.inert]);el.inert=true;
  }
  document.body.classList.add('modal-open');
  syncModalViewport();
}
function requestCloseModal(){
  if(!modalSession)return;
  if(modalSession.busy){toast('Aguarde a confirmação da operação.');return}
  const body=$('#modalBody');
  if(!modalSession.dirty){closeModal();return}
  if($('#modalDiscardPrompt'))return;
  const previous=document.activeElement;
  const prompt=document.createElement('section');
  prompt.id='modalDiscardPrompt';prompt.className='discard-prompt';
  prompt.setAttribute('role','alert');
  prompt.innerHTML='<p>Há alterações não salvas. Descartar essas alterações?</p><div class="action-row"><button type="button" class="btn" data-keep-editing>Continuar editando</button><button type="button" class="btn danger" data-discard-edit>Descartar alterações</button></div>';
  const siblings=[...body.children].map(el=>[el,el.inert]);
  for(const [el] of siblings)el.inert=true;
  body.prepend(prompt);
  const keep=()=>{
    prompt.remove();for(const [el,inert] of siblings)el.inert=inert;
    modalSession.cancelDiscard=null;
    if(previous?.isConnected)previous.focus();
  };
  modalSession.cancelDiscard=keep;
  $('[data-keep-editing]',prompt).onclick=keep;
  $('[data-discard-edit]',prompt).onclick=closeModal;
  $('[data-keep-editing]',prompt).focus();
}
document.addEventListener?.('keydown',event=>{
  if(!modalSession||event.isComposing)return;
  if(event.key==='Escape'){
    event.preventDefault();
    if(modalSession.cancelDiscard)modalSession.cancelDiscard();else requestCloseModal();
  }
  if(event.key==='Tab'){
    const targets=modalFocusables(),first=targets[0],last=targets.at(-1);
    if(!first){event.preventDefault();$('#modal .modal-card').focus();return}
    const active=document.activeElement;
    if(event.shiftKey&&(active===first||!targets.includes(active))){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&(active===last||!targets.includes(active))){event.preventDefault();first.focus()}
  }
});
document.addEventListener?.('focusin',event=>{
  if(modalSession&&!$('#modal').contains(event.target))$('#modal .modal-card').focus();
});
window.visualViewport?.addEventListener('resize',syncModalViewport);
window.visualViewport?.addEventListener('scroll',syncModalViewport);
function showModal(title,html,onSubmit,{entityKey=null}={}){
  const dialog=$('#modal'),body=$('#modalBody'),heading=$('#modalTitle');
  const key=entityKey||title;
  const same=state.modalKey===key&&!dialog.classList.contains('hidden');
  const opening=dialog.classList.contains('hidden');
  beginModalSession();
  const successor=!same;
  if(successor){modalSession.dirty=false;modalSession.busy=false;modalSession.cancelDiscard=null}
  heading.textContent=title;
  if(same&&body.childNodes?.length)renderRegion(body,html);
  else body.innerHTML=html;
  dialog.classList.remove('hidden');
  trackDirtyInputs(body);
  const token=Symbol('modal');
  state.modalToken=token;
  state.modalKey=key;
  if(opening||successor)$('#modal .modal-card').focus();
  body.oninput=()=>{if(modalSession)modalSession.dirty=true};
  body.onchange=body.oninput;
  const form=$('#modalBody form');
  if(form&&onSubmit)form.onsubmit=async e=>{
    e.preventDefault();
    if(modalSession?.busy)return;
    modalSession.busy=true;
    form.setAttribute('aria-busy','true');
    const btn=$('button[type=submit]',form);if(btn)btn.disabled=true;
    try{
      await onSubmit(new FormData(form));
      // Um callback pode abrir outro modal; não fechar seu sucessor.
      if(state.modalToken===token)closeModal();
    }catch(err){
      if(err?.pending&&state.modalToken===token)closeModal();
      if(state.modalToken===token){
        let error=$('[data-form-error]',form);
        if(!error){error=document.createElement('p');error.dataset.formError='';error.className='error';error.setAttribute('role','alert');form.prepend(error)}
        error.textContent=err.message;
      }
      toast(err.message,true);
    }
    finally{if(btn)btn.disabled=false;form.removeAttribute('aria-busy');if(state.modalToken===token&&modalSession)modalSession.busy=false}
  };
}
function closeModal(){
  const session=modalSession;modalSession=null;
  state.modalToken=null;state.modalKey=null;
  $('#modal').classList.add('hidden');$('#modalBody').innerHTML='';
  document.body.classList.remove('modal-open');
  if(session){
    for(const [el,inert] of session.background)el.inert=inert;
    const trigger=session.trigger;
    if(trigger?.isConnected&&!trigger.closest('[inert]'))trigger.focus();
    else $('#nav button.active')?.focus();
  }
}
function formObj(fd){return Object.fromEntries([...fd.entries()].map(([k,v])=>[k,typeof v==='string'?v.trim():v]))}
function badge(status){const cls=/PRONTA|ENTREGUE|APROVADA|PAGO/.test(status)?'green':/AGUARDANDO|ORCAMENTO|PARCIAL/.test(status)?'orange':/CANCELADA|REPROVADA/.test(status)?'red':'blue';return `<span class="pill ${cls}">${esc(status.replaceAll('_',' '))}</span>`}
function pageTitle(title,eyebrow='OFICINA'){ document.title=title+' · ArtiSys Oficina'; $('#pageTitle').textContent=title;$('#pageEyebrow').textContent=eyebrow }
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
  try{
    state.user=await api('/api/auth/me');
    showApp();await navigate('dashboard');
    void updatePendingCommands();
    void resumePendingCommands();
  }catch{showLogin()}
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
function logout(){
  if(modalSession)closeModal();
  state.pageController?.abort();state.pageEpoch++;state.pageReady=false;
  state.token='';state.user=null;localStorage.removeItem('oficina_token');
  void updatePendingCommands();showLogin();
}

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
function openMoreModules(){
  const secondary=$$('#nav button[data-page]:not([data-primary-nav])');
  showModal('Mais módulos',`<div class="more-modules" role="group" aria-label="Outras áreas do sistema">
    ${secondary.map(button=>`<button type="button" class="btn" data-more-page="${esc(button.dataset.page)}">
      ${esc(button.textContent.trim())}</button>`).join('')}
  </div>`,null,{entityKey:'more-modules'});
  $$('#modalBody [data-more-page]').forEach(button=>button.onclick=()=>{
    const destination=button.dataset.morePage;
    closeModal();void navigate(destination);
  });
}
async function navigate(page,{force=false}={}){
  if(state.page===page&&state.pageReady){
    if(force)return refreshCurrentPage();
    return;
  }
  state.pageController?.abort();
  state.pageController=new AbortController();
  const epoch=++state.pageEpoch;
  state.pageReady=false;
  state.page=page;
  $('#nav button[data-page]').forEach(b=>{
    const active=b.dataset.page===page;b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  const more=$('#moreModules');
  if(more){
    const secondary=!['dashboard','work-orders','schedule','customers'].includes(page);
    more.classList.toggle('active',secondary);
    if(secondary)more.setAttribute('aria-current','page');else more.removeAttribute('aria-current');
  }
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

