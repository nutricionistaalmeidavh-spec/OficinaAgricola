async function renderTechnicians(){pageTitle('Técnicos','EQUIPE');const techs=await api('/api/technicians');setContent(`<div class="section-head"><div><h2>Equipe técnica</h2><span class="muted">Responsáveis pelas OS</span></div>${state.user.role==='ADMIN'?'<button id="newTech" class="btn primary">+ Novo técnico</button>':''}</div>${table(['Nome','Telefone','Especialidade','Situação'],techs.map(t=>[`<strong>${esc(t.name)}</strong>`,esc(t.phone||'—'),esc(t.specialty||'—'),t.active?badge('ATIVO'):badge('INATIVO')]))}`);const b=$('#newTech');if(b)b.onclick=()=>techModal()}
function techModal(){const requestId=newCommandId();showModal('Novo técnico',`<form class="form-stack"><label>Nome<input name="name" required></label><div class="field-row"><label>Telefone<input name="phone"></label><label>Especialidade<input name="specialty"></label></div><button class="btn primary" type="submit">Salvar</button></form>`,async fd=>{await api('/api/technicians',{method:'POST',body:{...formObj(fd),requestId}});toast('Técnico cadastrado');await refreshCurrentPage()})}

async function renderSettings(){
  pageTitle('Configurações','ADMINISTRAÇÃO');
  const company=await api('/api/company');
  const isAdmin=state.user.role==='ADMIN';
  const users=isAdmin?await api('/api/users'):[];
  const readonly=isAdmin?'':' readonly aria-readonly="true"';
  const disabled=isAdmin?'':' disabled';
  const fiscalAllowed=['ADMIN','FINANCEIRO'].includes(state.user.role);
  const links=[
    ['company','Minha oficina','Dados cadastrais e perfil de atendimento'],
    ['users','Equipe e acessos','Contas e permissões da equipe'],
    ...(fiscalAllowed?[['fiscal','Configuração fiscal','Certificados, homologação e emissão de notas']]:[]),
    ['setup','Preparação do sistema','Acompanhe os passos para começar a trabalhar']
  ];
  const navigation=links.map(([id,title,description])=>'<button type="button" class="btn settings-jump" data-settings-target="'+id+'"><strong>'+title+'</strong><small>'+description+'</small></button>').join('');
  setContent(`<div class="settings-page">
    <p class="muted">Gerencie os dados da oficina e encontre rapidamente as configurações que precisa.</p>
    <div class="settings-links" aria-label="Áreas de configuração">${navigation}</div>
    <section class="card" id="settings-company"><div class="card-head"><h2>Minha oficina</h2></div>
      ${isAdmin?'':'<p class="muted" role="status">Somente administradores podem alterar estes dados. Você está visualizando as informações cadastradas.</p>'}
      <form id="companyForm" class="form-stack">
      <label>Nome da oficina<input name="name" value="${esc(company.name)}"${readonly}></label>
      <div class="field-row"><label>CNPJ ou documento<input name="document" value="${esc(company.document)}"${readonly}><small class="muted">Documento cadastrado da empresa.</small></label>
      <label>Telefone<input name="phone" value="${esc(company.phone)}"${readonly}></label></div>
      <label>E-mail<input name="email" value="${esc(company.email)}"${readonly}></label>
      <label>Endereço<input name="address" value="${esc(company.address)}"${readonly}></label>
      <label>Perfil da oficina<select name="serviceProfile"${disabled}>
        <option value="MISTA" ${company.service_profile==='MISTA'?'selected':''}>Mista — carros e máquinas</option>
        <option value="AUTOMOTIVA" ${company.service_profile==='AUTOMOTIVA'?'selected':''}>Automotiva multimarcas</option>
        <option value="AGRICOLA" ${company.service_profile==='AGRICOLA'?'selected':''}>Agrícola e máquinas pesadas</option>
      </select><small class="muted">Define o tipo de serviço atendido pela oficina.</small></label>
      ${isAdmin?'<button class="btn primary" type="submit">Salvar dados da oficina</button>':''}
      </form></section>
    <section class="card" id="settings-users"><div class="card-head"><h2>Equipe e acessos</h2>${isAdmin?'<button id="newUser" class="btn sm">+ Novo usuário</button>':''}</div>
      <p class="muted">Administrador gerencia a oficina; Atendimento registra operações; Técnico executa serviços; Financeiro acompanha as finanças.</p>
      ${isAdmin?(users.length?users.map(u=>`<div class="list-item"><div><strong>${esc(u.name)}</strong><br><small>${esc(u.username)}</small></div>${badge(userRoleLabel(u.role))}</div>`).join(''):'<div class="empty">Nenhum usuário cadastrado.</div>'):'<p class="muted">A lista de usuários é restrita aos administradores.</p>'}
    </section>
    ${fiscalAllowed?'<section class="card" id="settings-fiscal"><h2>Configuração fiscal</h2><p class="muted">Cadastre o emissor, configure certificados e consulte os testes de homologação na área Fiscal.</p><button class="btn" type="button" id="settingsFiscalOpen">Abrir área Fiscal</button></section>':''}
    <section class="card" id="settings-setup"><h2>Preparação do sistema</h2><p class="muted">O checklist de primeiro acesso mostra o que falta configurar para começar a operar.</p><button class="btn" type="button" id="settingsSetupOpen">Ver preparação do sistema</button></section>
  </div>`);
  const f=$('#companyForm');
  if(isAdmin)f.onsubmit=async e=>{e.preventDefault();if(state.pageSaving)return;state.pageSaving=true;const button=$('button[type=submit]',f);button.disabled=true;try{await api('/api/company',{method:'PATCH',body:formObj(new FormData(f))});state.pageDirty=false;toast('Empresa atualizada');await refreshCurrentPage()}catch(error){toast(error.message,true)}finally{state.pageSaving=false;button.disabled=false}};
  const nu=$('#newUser');if(nu)nu.onclick=userModal;
  const fiscal=$('#settingsFiscalOpen');if(fiscal)fiscal.onclick=()=>navigate('fiscal');
  const setup=$('#settingsSetupOpen');if(setup)setup.onclick=()=>navigate('dashboard');
  $$('.settings-jump').forEach(button=>button.onclick=()=>{
    const id=button.dataset.settingsTarget;
    const target=$('#settings-'+id);
    if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
    else if(id==='fiscal')navigate('fiscal');
    else if(id==='setup')navigate('dashboard');
  });
  if(window.OficinaTenant?.enabled&&isAdmin){
    const button=document.createElement('button');button.type='button';button.className='btn sm';
    button.textContent='Gerenciar empresas e unidades';
    button.onclick=()=>void openTenantAdmin().catch(error=>toast(error.message,true));
    $('#settings-company').append(button);
  }
}
function userModal(){const requestId=newCommandId();showModal('Novo usuário',`<form class="form-stack"><p class="muted">Administrador gerencia a oficina; Atendimento registra operações; Técnico executa serviços; Financeiro acompanha as finanças.</p><div class="field-row"><label>Nome<input name="name" required></label><label>Usuário<input name="username" required></label></div><div class="field-row"><label>Perfil<select name="role"><option value="ATENDIMENTO">Atendimento</option><option value="TECNICO">Técnico</option><option value="FINANCEIRO">Financeiro</option><option value="ADMIN">Administrador</option></select></label><label>Senha<input name="password" type="password" minlength="${window.OficinaTenant?.enabled?12:8}" required></label></div><button class="btn primary" type="submit">Criar usuário</button></form>`,async fd=>{await api('/api/users',{method:'POST',body:{...formObj(fd),requestId}});toast('Usuário criado');await refreshCurrentPage()})}

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
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,button=$('button[type="submit"]',form);
  if(button.disabled)return;button.disabled=true;button.textContent='Entrando…';form.setAttribute('aria-busy','true');
  $('#loginError').textContent='';
  try{
    const result=await api('/api/auth/login',{method:'POST',body:formObj(new FormData(form))});
    state.user=result.user;state.token='';if(window.OficinaTenant)await window.OficinaTenant.load();
    state.user=await api('/api/auth/me');showApp();await navigate('dashboard');
    void updatePendingCommands();void resumePendingCommands();
  }catch(err){$('#loginError').textContent=friendlyUiMessage(err.message);}
  finally{button.disabled=false;button.textContent='Entrar';form.removeAttribute('aria-busy');}
});
$('#logoutBtn').onclick=async()=>{if(!allowLeaveWorkshop())return;try{await api('/api/auth/logout',{method:'POST',body:{}})}catch{}logout()};$('#modalClose').onclick=requestCloseModal;$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')requestCloseModal()});$('#refreshBtn').onclick=()=>navigate(state.page,{force:true});$$('#nav button').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
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

