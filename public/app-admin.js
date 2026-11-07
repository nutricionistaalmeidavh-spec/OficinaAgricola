async function renderTechnicians(){pageTitle('Técnicos','EQUIPE');const techs=await api('/api/technicians');setContent(`<div class="section-head"><div><h2>Equipe técnica</h2><span class="muted">Responsáveis pelas OS</span></div>${state.user.role==='ADMIN'?'<button id="newTech" class="btn primary">+ Novo técnico</button>':''}</div>${table(['Nome','Telefone','Especialidade','Situação'],techs.map(t=>[`<strong>${esc(t.name)}</strong>`,esc(t.phone||'—'),esc(t.specialty||'—'),t.active?badge('ATIVO'):badge('INATIVO')]))}`);const b=$('#newTech');if(b)b.onclick=()=>techModal()}
function techModal(){const requestId=newCommandId();showModal('Novo técnico',`<form class="form-stack"><label>Nome<input name="name" required></label><div class="field-row"><label>Telefone<input name="phone"></label><label>Especialidade<input name="specialty"></label></div><button class="btn primary" type="submit">Salvar</button></form>`,async fd=>{await api('/api/technicians',{method:'POST',body:{...formObj(fd),requestId}});toast('Técnico cadastrado');await refreshCurrentPage()})}

function settingsUserEnabled(user){
  return Number(user.active)===1&&(user.membershipActive===undefined||Number(user.membershipActive)===1);
}
function settingsUserIdentityEditable(user){
  return user.identityEditable===undefined||user.identityEditable===true||user.identityEditable===1;
}
function settingsUserRow(user){
  const id=Number(user.id),active=settingsUserEnabled(user);
  const myself=id===Number(state.user.id);
  return `<div class="list-item settings-user-row">
    <div class="settings-user-info"><strong>${esc(user.name)}</strong>
      <small>${esc(user.username)}</small>
      <div class="settings-user-badges">${badge(userRoleLabel(user.role))}
        <span class="pill ${active?'green':'orange'}">${active?'Ativo':'Inativo'}</span>
      </div>
    </div>
    <div class="settings-user-actions">
      <button type="button" class="btn sm" data-user-action="edit" data-user-id="${id}" aria-label="Editar ${esc(user.name)}">Editar</button>
      <button type="button" class="btn sm" data-user-action="reset" data-user-id="${id}"
        ${settingsUserIdentityEditable(user)?'':'disabled title="Conta compartilhada: apenas o administrador da plataforma pode redefinir esta senha"'}>Redefinir senha</button>
      <button type="button" class="btn sm" data-user-action="toggle" data-user-id="${id}"
        ${myself?'disabled title="Não é possível desativar seu próprio acesso nesta tela"':''}>${active?'Desativar':'Reativar'}</button>
    </div>
  </div>`;
}

async function renderSettings(){
  pageTitle('Configurações','ADMINISTRAÇÃO');
  const company=await api('/api/company');
  const isAdmin=state.user.role==='ADMIN';
  const users=isAdmin?await api('/api/users'):[];
  const readonly=isAdmin?'':' readonly aria-readonly="true"';
  const disabled=isAdmin?'':' disabled';
  const links=[
    ['company','Minha oficina','Dados cadastrais e perfil de atendimento'],
    ['users','Equipe e acessos','Contas e permissões da equipe'],
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
      ${isAdmin?(users.length?users.map(settingsUserRow).join(''):'<div class="empty">Nenhum usuário cadastrado.</div>'):'<p class="muted">A lista de usuários é restrita aos administradores.</p>'}
    </section>
    <section class="card" id="settings-setup"><h2>Preparação do sistema</h2><p class="muted">O checklist de primeiro acesso mostra o que falta configurar para começar a operar.</p><button class="btn" type="button" id="settingsSetupOpen">Ver preparação do sistema</button></section>
  </div>`);
  const f=$('#companyForm');
  if(isAdmin)f.onsubmit=async e=>{e.preventDefault();if(state.pageSaving)return;state.pageSaving=true;const button=$('button[type=submit]',f);button.disabled=true;try{await api('/api/company',{method:'PATCH',body:formObj(new FormData(f))});state.pageDirty=false;toast('Empresa atualizada');await refreshCurrentPage()}catch(error){toast(error.message,true)}finally{state.pageSaving=false;button.disabled=false}};
  const nu=$('#newUser');if(nu)nu.onclick=userModal;
  if(isAdmin)document.querySelectorAll('#settings-users [data-user-action]').forEach(button=>{
    const user=users.find(item=>Number(item.id)===Number(button.dataset.userId));
    if(!user)return;
    button.onclick=()=>{
      if(button.dataset.userAction==='edit')return editSettingsUser(user);
      if(button.dataset.userAction==='reset')return resetSettingsUserPassword(user);
      if(button.dataset.userAction==='toggle')return void toggleSettingsUser(user,button);
    };
  });

  const setup=$('#settingsSetupOpen');if(setup)setup.onclick=()=>navigate('dashboard');
  $$('.settings-jump').forEach(button=>button.onclick=()=>{
    const id=button.dataset.settingsTarget;
    const target=$('#settings-'+id);
    if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
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


function editSettingsUser(user){
  const canEditName=settingsUserIdentityEditable(user);
  const roles=[['ADMIN','Administrador'],['ATENDIMENTO','Atendimento'],['TECNICO','Técnico'],['FINANCEIRO','Financeiro']];
  const choices=roles.map(([value,label])=>`<option value="${value}" ${user.role===value?'selected':''}>${label}</option>`).join('');
  showModal('Editar usuário',`<form class="form-stack">
    <p class="muted">Edite o perfil de acesso à unidade. O nome de usuário usado para entrar não pode ser alterado aqui.</p>
    <label>Usuário<input value="${esc(user.username)}" readonly aria-readonly="true"></label>
    <label>Nome<input name="name" value="${esc(user.name)}" maxlength="100" minlength="2" required
      ${canEditName?'':'readonly aria-readonly="true"'}></label>
    ${canEditName?'':'<p class="muted">Conta usada em outras unidades. Somente a administração da plataforma pode alterar o nome e a senha.</p>'}
    <label>Perfil nesta unidade<select name="role">${choices}</select></label>
    <button class="btn primary" type="submit">Salvar alterações</button>
  </form>`,async fd=>{
    const body={role:String(fd.get('role')),active:settingsUserEnabled(user)};
    if(canEditName)body.name=String(fd.get('name')||'').trim();
    await api('/api/users/'+Number(user.id),{method:'PATCH',body});
    toast('Usuário atualizado');await refreshCurrentPage();
  },{entityKey:'edit-user-'+Number(user.id)});
}
function resetSettingsUserPassword(user){
  if(!settingsUserIdentityEditable(user)){
    toast('Conta compartilhada: somente a administração da plataforma pode redefinir a senha.',true);return;
  }
  const minimum=window.OficinaTenant?.enabled?12:8;
  showModal('Redefinir senha',`<form class="form-stack">
    <p class="muted">Defina uma nova senha para ${esc(user.name)}. As sessões anteriores deste usuário serão encerradas.</p>
    <label>Nova senha<input name="newPassword" type="password" autocomplete="new-password"
      minlength="${minimum}" maxlength="256" required></label>
    <label>Confirmar nova senha<input name="confirmNewPassword" type="password"
      autocomplete="new-password" minlength="${minimum}" maxlength="256" required></label>
    <button class="btn primary" type="submit">Confirmar nova senha</button>
  </form>`,async fd=>{
    const password=String(fd.get('newPassword')||'');
    if(password!==String(fd.get('confirmNewPassword')||''))throw new Error('As senhas não coincidem');
    if(password.length<minimum||password.length>256)throw new Error('Senha fora do tamanho permitido');
    await api('/api/users/'+Number(user.id),{method:'PATCH',
      body:{role:user.role,active:settingsUserEnabled(user),password}});
    if(Number(user.id)===Number(state.user.id)){
      toast('Senha alterada. Entre novamente com a nova senha.');logout();
    }else{
      toast('Senha redefinida. As sessões anteriores foram encerradas.');
      await refreshCurrentPage();
    }
  },{entityKey:'reset-user-'+Number(user.id)});
}
async function toggleSettingsUser(user,button){
  if(Number(user.id)===Number(state.user.id)){
    toast('Você não pode desativar seu próprio acesso por esta tela.',true);return;
  }
  const active=settingsUserEnabled(user);
  if(!confirm(active?`Desativar o acesso de ${user.name} nesta unidade?`:
    `Reativar o acesso de ${user.name} nesta unidade?`))return;
  button.disabled=true;
  try{
    await api('/api/users/'+Number(user.id),{method:'PATCH',body:{role:user.role,active:!active}});
    toast(active?'Acesso desativado':'Acesso reativado');
    await refreshCurrentPage();
  }catch(error){toast(error.message,true)}
  finally{button.disabled=false}
}

function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="empty">Nenhum registro.</td></tr>`}</tbody></table></div>`}

const pendingRecovery=$('#pendingCommands');
if(pendingRecovery)pendingRecovery.onclick=()=>void openPendingCommands();
$('#licenseForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget,button=$('button[type="submit"]',form),error=$('#licenseError');
  if(button.disabled)return;
  button.disabled=true;error.textContent='';
  try{
    await api('/api/license/activate',{method:'POST',body:formObj(new FormData(form))});
    form.reset();toast('Licença ativada. Continue a configuração da oficina.');
    await boot();
  }catch(err){error.textContent=friendlyUiMessage(err.message)}
  finally{button.disabled=false}
});
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

