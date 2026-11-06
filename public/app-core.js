const $=(s,root=document)=>root.querySelector(s); const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const state={token:'',user:null,page:'dashboard',pageReady:false,pageEpoch:0,pageController:null,modalToken:null,modalKey:null};
const dirtyInputs=new WeakSet();
// ID + usuário evita reenviar comandos para outra conta quando um banco for recriado.
const currentCommandOwner=()=>state.user?
  String(state.user.id)+':'+String(state.user.username||'')+':unit:'+String(window.OficinaTenant?.getUnitId()||'default'):null;
const commandQueue=window.OficinaCommands?.createQueue({
  send:({path,method,body})=>{
    // Autorizações nunca entram no IndexedDB; cada envio usa a sessão atual.
    const headers=window.OficinaTenant?.headers({'Content-Type':'application/json'})||{'Content-Type':'application/json'};
    const transport=window.localRuntime?.request||fetch;
    return transport(path,{method,headers,body:JSON.stringify(body)});
  },
  lookup:async({path,method,requestId})=>{
    const query=new URLSearchParams({path,method,requestId});
    const transport=window.localRuntime?.request||fetch;
    const response=await transport('/api/commands/status?'+query.toString(),{headers:window.OficinaTenant?.headers()||{}});
    if(!response.ok)throw new Error('Não foi possível consultar a confirmação');
    return response.json();
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
      ?'1 operação aguardando confirmação · Revisar'
      :count+' operações aguardando confirmação · Revisar';
  }catch(error){
    // Erro de armazenamento não pode ser tratado como operação confirmada.
    button.classList.remove('hidden');
    button.textContent='Verificar armazenamento local de operações';
    button.title=error.message;
  }
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
function pendingCommandLabel(record){
  const path=record.path,body=record.body||{};
  const label=path.includes('/receipts')?'Recebimento':
    path.includes('/sales')?'Venda':
    path.includes('/cash/')?'Operação de caixa':
    path.includes('/inventory/')||path.endsWith('/parts')?'Movimentação de estoque':
    path.includes('/work-orders')?'Ordem de serviço':
    path.includes('/customers')?'Cliente':
    path.includes('/machines')?'Equipamento':
    path.includes('/expenses')?'Despesa':'Alteração de cadastro';
  const name=body.name||body.description||body.title||body.problemReported||'';
  const value=Number(body.amountCents);
  return {label,detail:String(name).slice(0,120),
    amount:Number.isFinite(value)&&value>0?money(value):null};
}
async function openPendingCommands(){
  if(!state.user||!commandQueue)return;
  const owner=currentCommandOwner(),rows=await commandQueue.list(owner);
  if(!rows.length){toast('Nenhuma operação pendente');return}
  rows.sort((a,b)=>a.createdAt-b.createdAt);
  showModal('Operações aguardando confirmação',
    `<div class="pending-list">
      <p class="muted">Estas operações estão salvas neste dispositivo. O sistema consulta o servidor antes de reenviar uma tentativa.</p>
      ${rows.map(item=>{
        const d=pendingCommandLabel(item);
        const highRisk=(item.policy||'review')==='review';
        return `<section class="pending-item" data-pending-id="${esc(item.id)}">
          <strong>${esc(d.label)}</strong> <span class="pill orange">${highRisk?'Revisão obrigatória':'Aguardando confirmação'}</span>
          <p>${esc(d.detail)}${d.amount?' · '+esc(d.amount):''}</p>
          <small>${new Date(item.createdAt).toLocaleString('pt-BR')} · ${item.status==='auth'?'Sessão necessária':item.status==='pending'?'Sem confirmação':'Enviado'}</small>
          <div class="action-row"><button type="button" class="btn sm ${highRisk?'':'soft'}" data-queue-retry="${esc(item.id)}">
            ${highRisk?'Revisar e tentar novamente':'Consultar / tentar novamente'}
          </button></div>
        </section>`;
      }).join('')}
    </div>`);
  $$('[data-queue-retry]').forEach(button=>button.onclick=async()=>{
    const id=button.dataset.queueRetry;
    if(!state.user||currentCommandOwner()!==owner)return;
    if(button.textContent.includes('Revisar')){
      button.textContent='Confirmar tentativa desta operação';
      button.classList.add('primary');
      return;
    }
    button.disabled=true;
    try{
      const count=await commandQueue.replay(owner,{manual:true,ids:[id]});
      if(count)await refreshCurrentPage();
      await updatePendingCommands();
      const remain=await commandQueue.list(owner);
      if(!remain.length){closeModal();toast('Operação confirmada');}
      else{closeModal();await openPendingCommands()}
    }catch(error){toast(error.message,true);button.disabled=false}
  });
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
  host.addEventListener('input',e=>{if(e.target)dirtyInputs.add(e.target);if(host.id==='content'&&e.target?.closest?.('form'))state.pageDirty=true});
  host.__draftTracking=true;
}
const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
const dt=v=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
async function api(path,{method='GET',body,raw=false,binary=false}={}){
  const headers=window.OficinaTenant?.headers()||{};
  if(path==='/api/auth/login')headers['X-Session-Transport']='cookie';
  if(body!==undefined)headers['Content-Type']='application/json';
  const requester=window.localRuntime?.request||fetch;
  const isRead=method==='GET',epoch=state.pageEpoch;
  const signal=isRead?state.pageController?.signal:undefined;
  const res=!isRead&&!raw&&commandQueue&&state.user
    ?await commandQueue.execute({ownerId:currentCommandOwner(),path,method,body:body||{}})
    :await requester(path,{method,headers,signal,body:body===undefined?undefined:JSON.stringify(body)});
  if(isRead&&(signal?.aborted||epoch!==state.pageEpoch))throw new DOMException('Consulta obsoleta','AbortError');
  if(res.status===401){logout();throw new Error('Sessão expirada')}
  if(binary&&res.ok){
    const bytes=new Uint8Array(await res.arrayBuffer());
    if(isRead&&(signal?.aborted||epoch!==state.pageEpoch))throw new DOMException('Consulta obsoleta','AbortError');
    return bytes;
  }
  const text=await res.text();
  if(isRead&&(signal?.aborted||epoch!==state.pageEpoch))throw new DOMException('Consulta obsoleta','AbortError');
  if(!res.ok){let msg=text;try{msg=JSON.parse(text).error}catch{}throw Object.assign(new Error(msg||'Erro na operação'),{status:res.status})}
  return raw?text:(text?JSON.parse(text):null);
}
let toastTimer=null;
function friendlyUiMessage(value){const text=String(value||'');return /SQLITE|TypeError|ReferenceError|SyntaxError|ENOENT|EACCES|node:internal|file:\/\/|\.sqlite\b|(?:token|password|secret)\s*[:=]/i.test(text)?'Não foi possível concluir a operação. Tente novamente ou consulte o suporte.':text}
function toast(msg,error=false){
  const el=$('#toast');
  clearTimeout(toastTimer);
  el.textContent=friendlyUiMessage(msg);el.className=`toast${error?' error':''}`;
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
      $$('input,textarea,select',form).forEach(input=>dirtyInputs.delete(input));
      // Um callback pode abrir outro modal; não fechar seu sucessor.
      if(state.modalToken===token)closeModal();
    }catch(err){
      // Manter o rascunho mesmo se a confirmação estiver pendente na fila.
      if(state.modalToken===token){
        let error=$('[data-form-error]',form);
        if(!error){error=document.createElement('p');error.dataset.formError='';error.className='error';error.setAttribute('role','alert');form.prepend(error)}
        error.textContent=friendlyUiMessage(err.message);
      }
      toast(err.message,true);
    }
    finally{if(btn)btn.disabled=false;form.removeAttribute('aria-busy');if(state.modalToken===token&&modalSession)modalSession.busy=false}
  };
}
function closeModal(){
  window.OficinaBarcode?.stopCamera();
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
function workOrderSelector(orders,{name='workOrderId',id='',label='OS vinculada (opcional)'}={}){
 const options=(orders||[]).map(o=>'<option value="'+Number(o.id)+'">OS #'+esc(o.os_number)+' · '+esc(o.problem_reported||'Sem descrição')+'</option>').join('');
 return '<label>'+esc(label)+'<select '+(id?'id="'+id+'" ':'')+'name="'+name+'"><option value="">Sem vínculo com OS</option>'+options+'</select></label>';
}
function userRoleLabel(role){return ({ADMIN:'Administrador',ATENDIMENTO:'Atendimento',TECNICO:'Técnico',FINANCEIRO:'Financeiro'}[role]||'Equipe')}
function badge(status){const cls=/PRONTA|ENTREGUE|APROVADA|PAGO/.test(status)?'green':/AGUARDANDO|ORCAMENTO|PARCIAL/.test(status)?'orange':/CANCELADA|REPROVADA|TRANSFERIDA/.test(status)?'red':'blue';return `<span class="pill ${cls}">${esc(status.replaceAll('_',' '))}</span>`}
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

// Progressive, cursor-based collections; never request every row for a list view.
function showPagedLoadMore({cursor,loaded,total,onMore,label='Carregar mais'}){
  const host=$('#content');
  if(!host)return;
  host.querySelector('#pagedLoadMore')?.remove();
  if(!cursor)return;
  const group=document.createElement('div');
  group.id='pagedLoadMore';
  group.className='action-row';
  group.style.marginTop='12px';
  group.style.justifyContent='space-between';
  const status=document.createElement('small');
  status.className='muted';
  status.textContent=loaded+' de '+total+' registros carregados';
  const button=document.createElement('button');
  button.className='btn sm soft';
  button.type='button';
  button.textContent=label;
  button.onclick=async()=>{
    button.disabled=true;
    try{await onMore();}catch(error){toast(error.message,true);button.disabled=false;}
  };
  group.append(status,button);
  host.appendChild(group);
}

async function boot(){
  $('#today').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'});
  try{
    const license=await api('/api/license/status');
    if(license.required&&!license.active){state.token='';return showLicense()}
    const setup=await api('/api/setup/status');
    if(setup.required){state.token='';return showSetup()}
  }catch{ /* The login view will display server errors if offline. */ }
  // Sessão restaurada automaticamente pelo cookie HttpOnly; nunca pelo localStorage.
  try{
    state.user=await api('/api/auth/me');
    if(window.OficinaTenant)await window.OficinaTenant.load();
    state.user=await api('/api/auth/me');
    showApp();await navigate('dashboard');
    void updatePendingCommands();
    void resumePendingCommands();
  }catch{showLogin()}
}
function showLicense(){
   $('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden');
   $('#loginForm').classList.add('hidden');$('#setupForm').classList.add('hidden');
   $('#licenseForm').classList.remove('hidden');
 }
 function showSetup(){
  $('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden');
  $('#loginForm').classList.add('hidden');$('#licenseForm').classList.add('hidden');$('#setupForm').classList.remove('hidden');
}
function showLogin(){
  $('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden');
  $('#setupForm').classList.add('hidden');$('#licenseForm').classList.add('hidden');$('#loginForm').classList.remove('hidden');
}
function canViewModule(page){
 return Boolean(window.OficinaRolePermissions?.canViewPage(state.user?.role,page));
}
function showApp(){
 $('#loginView').classList.add('hidden');
 $('#appView').classList.remove('hidden');
 $('#userName').textContent=state.user.name;
 $('#userRole').textContent=userRoleLabel(state.user.role);
 $('#avatar').textContent=state.user.name[0]?.toUpperCase()||'A';
 for(const button of document.querySelectorAll('#nav [data-page],#mobileMorePanel [data-mobile-page]')){
  const page=button.dataset.page||button.dataset.mobilePage;
  button.hidden=!canViewModule(page);
 }
}
function logout(){
  window.OficinaBarcode?.stopCamera();
  if(modalSession)closeModal();
  state.pageController?.abort();state.pageEpoch++;state.pageReady=false;
  state.token='';state.user=null;
  void updatePendingCommands();showLogin();
}

function pageRenderer(page){
  const dashboard=typeof renderDashboard==='function'?async()=>{
    await renderDashboard();
    if(state.user?.role==='ADMIN'&&window.OficinaFirstAccess)
      await window.OficinaFirstAccess.renderBanner();
  }:async()=>{};
  const fiscal=typeof renderFiscal==='function'?renderFiscal:async()=>{};
  const market=typeof renderMarketParity==='function'?renderMarketParity:async()=>{};
  return ({
    dashboard,customers:renderCustomers,machines:renderMachines,
    'work-orders':renderWorkOrders,inventory:renderInventory,schedule:renderSchedule,
    finance:renderFinance,reports:renderReports,fiscal,technicians:renderTechnicians,
    settings:renderSettings,services:renderServices,sales:renderSales,market
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
 if(!canViewModule(page)){toast('Seu perfil não tem acesso a este módulo.',true);return;}
  if(page!==state.page&&!allowLeaveWorkshop())return;
  if(page!==state.page)window.OficinaBarcode?.stopCamera();
  $('#mobileMorePanel')?.classList.add('hidden');
  $('#mobileMoreBtn')?.setAttribute?.('aria-expanded','false');
  if(state.page===page&&state.pageReady){
    if(force)return refreshCurrentPage();
    return;
  }
  state.pageController?.abort();
  state.pageController=new AbortController();
  const epoch=++state.pageEpoch;
  state.pageReady=false;
  state.page=page;
  $$('#nav button').forEach(b=>{
    const active=b.dataset.page===page;b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  setContent('<div class="card"><div class="empty">Carregando…</div></div>');
  try{
    await pageRenderer(page)();
    if(epoch===state.pageEpoch)state.pageReady=true;
  }catch(err){
    if(epoch!==state.pageEpoch||err.name==='AbortError')return;
    setContent(`<div class="card"><div class="empty error">${esc(friendlyUiMessage(err.message))}</div></div>`);
    toast(err.message,true);
  }
}

function stat(label,value,cls=''){return `<div class="stat"><small>${label}</small><strong class="${cls}">${value}</strong></div>`}


// Mudanças de unidade, navegação, logout e fechamento preservam o mesmo contrato.
function allowLeaveWorkshop(){
  if(modalSession?.busy||state.pageSaving){toast('Aguarde a confirmação da operação.');return false;}
  if((modalSession?.dirty||state.pageDirty)&&!confirm('Há alterações não salvas. Deseja descartá-las e continuar?'))return false;
  state.pageDirty=false;
  if(modalSession)closeModal();
  return true;
}
window.OficinaDrafts={allowLeave:allowLeaveWorkshop};
window.addEventListener?.('beforeunload',event=>{
  if(modalSession?.dirty||modalSession?.busy||state.pageDirty||state.pageSaving){event.preventDefault();event.returnValue='';}
});

// Trocar a ação da OS não pode apagar um diagnóstico em edição.
document.addEventListener?.('click',event=>{
  if(!modalSession?.dirty)return;
  const action=event.target?.closest?.('#quoteBtn,#partBtn,#checkBtn,#photoBtn,#payBtn,#collectBtn,#billingPlanBtn,#editFullOS,#duplicateOS,#historyOS,#approvalLinkOS,[data-reverse-part],[data-reverse-receipt]');
  if(!action||!action.closest('#modalBody'))return;
  event.preventDefault();event.stopImmediatePropagation();toast('Salve as alterações antes de abrir outra ação da OS.',true);
},true);
