async function renderTechnicians(){pageTitle('Técnicos','EQUIPE');const techs=await api('/api/technicians');setContent(`<div class="section-head"><div><h2>Equipe técnica</h2><span class="muted">Responsáveis pelas OS</span></div>${state.user.role==='ADMIN'?'<button id="newTech" class="btn primary">+ Novo técnico</button>':''}</div>${table(['Nome','Telefone','Especialidade','Situação'],techs.map(t=>[`<strong>${esc(t.name)}</strong>`,esc(t.phone||'—'),esc(t.specialty||'—'),t.active?badge('ATIVO'):badge('INATIVO')]))}`);const b=$('#newTech');if(b)b.onclick=()=>techModal()}
function techModal(){const requestId=newCommandId();showModal('Novo técnico',`<form class="form-stack"><label>Nome<input name="name" required></label><div class="field-row"><label>Telefone<input name="phone"></label><label>Especialidade<input name="specialty"></label></div><button class="btn primary" type="submit">Salvar</button></form>`,async fd=>{await api('/api/technicians',{method:'POST',body:{...formObj(fd),requestId}});toast('Técnico cadastrado');await refreshCurrentPage()})}

async function renderSettings(){pageTitle('Configurações','ADMINISTRAÇÃO');const company=await api('/api/company');let users=[];if(state.user.role==='ADMIN')users=await api('/api/users');setContent(`<div class="grid two-col"><div class="card"><div class="card-head"><h2>Dados da empresa</h2></div><form id="companyForm" class="form-stack"><label>Nome<input name="name" value="${esc(company.name)}"></label><div class="field-row"><label>CNPJ/Documento<input name="document" value="${esc(company.document)}"></label><label>Telefone<input name="phone" value="${esc(company.phone)}"></label></div><label>E-mail<input name="email" value="${esc(company.email)}"></label><label>Endereço<input name="address" value="${esc(company.address)}"></label><label>Perfil da oficina<select name="serviceProfile"><option value="MISTA" ${company.service_profile==='MISTA'?'selected':''}>Mista — carros e máquinas</option><option value="AUTOMOTIVA" ${company.service_profile==='AUTOMOTIVA'?'selected':''}>Automotiva multimarcas</option><option value="AGRICOLA" ${company.service_profile==='AGRICOLA'?'selected':''}>Agrícola e máquinas pesadas</option></select></label>${state.user.role==='ADMIN'?'<button class="btn primary" type="submit">Salvar empresa</button>':''}</form></div><div class="card"><div class="card-head"><h2>Usuários e perfis</h2>${state.user.role==='ADMIN'?'<button id="newUser" class="btn sm">+ Usuário</button>':''}</div>${users.length?users.map(u=>`<div class="list-item"><div><strong>${esc(u.name)}</strong><br><small>${esc(u.username)}</small></div>${badge(u.role)}</div>`).join(''):'<div class="empty">Visível apenas para ADMIN.</div>'}</div></div>`);const f=$('#companyForm');if(state.user.role==='ADMIN')f.onsubmit=async e=>{e.preventDefault();await api('/api/company',{method:'PATCH',body:formObj(new FormData(f))});toast('Empresa atualizada');await refreshCurrentPage()};const nu=$('#newUser');if(nu)nu.onclick=userModal}
function userModal(){const requestId=newCommandId();showModal('Novo usuário',`<form class="form-stack"><div class="field-row"><label>Nome<input name="name" required></label><label>Usuário<input name="username" required></label></div><div class="field-row"><label>Perfil<select name="role"><option>ATENDIMENTO</option><option>TECNICO</option><option>FINANCEIRO</option><option>ADMIN</option></select></label><label>Senha<input name="password" type="password" minlength="8" required></label></div><button class="btn primary" type="submit">Criar usuário</button></form>`,async fd=>{await api('/api/users',{method:'POST',body:{...formObj(fd),requestId}});toast('Usuário criado');await refreshCurrentPage()})}

function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="empty">Nenhum registro.</td></tr>`}</tbody></table></div>`}

const pendingRecovery=$('#pendingCommands');
if(pendingRecovery)pendingRecovery.onclick=()=>void openPendingCommands();
$('#setupForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget,button=$('button[type="submit"]',form);
  const error=$('#setupError');error.textContent='';
  const data=formObj(new FormData(form));
  if(data.password!==data.confirmPassword){error.textContent='As senhas não coincidem';return}
  button.disabled=true;
  try{
    await api('/api/setup/initialize',{method:'POST',body:data});
    $('#loginForm input[name="username"]').value=data.username;
    form.reset();
    showLogin();
    toast('Administrador criado. Faça login com sua senha.');
  }catch(err){error.textContent=err.message}
  finally{button.disabled=false}
});
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const o=formObj(new FormData(e.target));try{const result=await api('/api/auth/login',{method:'POST',body:o});state.user=result.user;state.token='';showApp();await navigate('dashboard');void updatePendingCommands();void resumePendingCommands()}catch(err){$('#loginError').textContent=err.message}});
$('#logoutBtn').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST',body:{}})}catch{}logout()};$('#modalClose').onclick=requestCloseModal;$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')requestCloseModal()});$('#refreshBtn').onclick=()=>navigate(state.page,{force:true});$$('#nav button').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
// Barra mobile: quatro destinos diretos e demais módulos acessíveis por Mais.
const mobileMore=$('#mobileMoreBtn'),mobilePanel=$('#mobileMorePanel');
function closeMobileMore(){
  mobilePanel?.classList.add('hidden');
  mobileMore?.setAttribute('aria-expanded','false');
}
if(mobileMore)mobileMore.onclick=()=>{
  const open=mobilePanel.classList.toggle('hidden')===false;
  mobileMore.setAttribute('aria-expanded',String(open));
  if(open)mobilePanel.querySelector('button')?.focus();
};
$$('[data-mobile-page]').forEach(button=>button.onclick=()=>{
  closeMobileMore();void navigate(button.dataset.mobilePage);
});
const mobileSearch=$('#mobileSearchBtn');
if(mobileSearch)mobileSearch.onclick=()=>{
  closeMobileMore();
  showModal('Buscar na oficina',`<form class="form-stack">
    <label>Cliente, equipamento ou OS<input name="query" type="search" minlength="2" autofocus required placeholder="Digite para buscar"></label>
    <button class="btn primary" type="submit">Buscar</button>
  </form>`,async fd=>{await runGlobalSearch(String(fd.get('query')||''))});
};
const mobileLogout=$('#mobileLogoutBtn');
if(mobileLogout)mobileLogout.onclick=()=>{
  closeMobileMore();$('#logoutBtn').click();
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileMore()});
document.addEventListener('click',e=>{
  if(mobileMore&&!mobileMore.contains(e.target)&&!mobilePanel?.contains(e.target))closeMobileMore();
});
boot();

