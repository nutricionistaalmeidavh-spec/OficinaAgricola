'use strict';
async function openTenantAdmin(){
  const tenant=window.OficinaTenant;
  if(!tenant?.enabled)return;
  const context=await api('/api/tenancy/context');
  const units=context.units||[];
  const managed=units.filter(u=>u.role==='ADMIN');
  if(!context.platformAdmin&&!managed.length)throw new Error('Acesso administrativo necessário');
  const companies=[...new Map(managed.map(u=>[u.companyId,{id:u.companyId,name:u.companyName}])).values()];
  const unitOptions=managed.map(u=>'<option value="'+u.id+'">'+esc(u.companyName)+' / '+esc(u.name)+'</option>').join('');
  const companyOptions=companies.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
  showModal('Empresas e unidades',`<div class="form-stack">
    <p class="muted">Cada unidade possui banco de dados e anexos isolados. O acesso depende do vínculo do usuário.</p>
    <div class="field-row">
      ${context.platformAdmin?'<button type="button" class="btn" id="createTenantCompany">+ Empresa</button>':''}
      ${managed.length?'<button type="button" class="btn" id="createTenantUnit">+ Unidade</button>':''}
      ${managed.length?'<button type="button" class="btn" id="addTenantMember">+ Vincular usuário</button>':''}
    </div>
    <div class="list">${units.map(u=>'<div class="list-item"><div><strong>'+esc(u.companyName)+' / '+esc(u.name)+'</strong><br><small>'+esc(u.code)+' · '+esc(u.role)+'</small></div></div>').join('')}</div>
  </div>`);
  const newCompany=$('#createTenantCompany');
  if(newCompany)newCompany.onclick=()=>showModal('Cadastrar empresa',`<form class="form-stack">
    <label>Identificador único<input name="slug" minlength="2" maxlength="40" pattern="[a-z][a-z0-9-]+" placeholder="empresa-do-cliente" required></label>
    <label>Nome da empresa<input name="name" required maxlength="120"></label>
    <button class="btn primary" type="submit">Cadastrar</button>
  </form>`,async fd=>{
    await api('/api/tenancy/companies',{method:'POST',body:formObj(fd)});
    toast('Empresa criada e vinculada ao administrador');location.reload();
  });
  const newUnit=$('#createTenantUnit');
  if(newUnit)newUnit.onclick=()=>showModal('Cadastrar unidade',`<form class="form-stack">
    <label>Empresa<select name="companyId">${companyOptions}</select></label>
    <label>Código<input name="code" minlength="2" maxlength="32" required></label>
    <label>Nome<input name="name" maxlength="120" required></label>
    <button class="btn primary" type="submit">Cadastrar unidade</button>
  </form>`,async fd=>{
    await api('/api/tenancy/units',{method:'POST',body:formObj(fd)});
    toast('Unidade cadastrada');location.reload();
  });
  const invite=$('#addTenantMember');
  if(invite)invite.onclick=()=>showModal('Vincular usuário à unidade',`<form class="form-stack">
    <label>Unidade<select name="unitId">${unitOptions}</select></label>
    <label>Usuário existente ou novo<input name="username" minlength="3" maxlength="40" required></label>
    <label>Nome (obrigatório apenas para usuário novo)<input name="name"></label>
    <label>Senha (apenas usuário novo, 12+ caracteres)<input type="password" name="password" minlength="12" autocomplete="new-password"></label>
    <label>Permissão<select name="role"><option>ATENDIMENTO</option><option>TECNICO</option><option>FINANCEIRO</option><option>ADMIN</option></select></label>
    <button class="btn primary" type="submit">Vincular</button>
  </form>`,async fd=>{
    await api('/api/tenancy/memberships',{method:'POST',body:formObj(fd)});
    toast('Vínculo salvo');location.reload();
  });
}
const manageTenancy=document.querySelector('#tenantManageBtn');
if(manageTenancy)manageTenancy.onclick=()=>void openTenantAdmin().catch(error=>toast(error.message,true));
