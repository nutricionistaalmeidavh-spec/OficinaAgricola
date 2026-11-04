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
  const possibleCatalogSources=managed.filter(u=>managed.some(v=>v.companyId===u.companyId&&v.id!==u.id));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  showModal('Empresas e unidades',`<div class="form-stack">
    <p class="muted">Cada unidade possui banco de dados e anexos isolados. O acesso depende do vínculo do usuário.</p>
    <div class="field-row">
      ${context.platformAdmin?'<button type="button" class="btn" id="createTenantCompany">+ Empresa</button>':''}
      ${managed.length?'<button type="button" class="btn" id="createTenantUnit">+ Unidade</button>':''}
      ${managed.length?'<button type="button" class="btn" id="addTenantMember">+ Vincular usuário</button>':''}
      ${managed.length?'<button type="button" class="btn" id="editTenantMember">Alterar acessos</button>':''}
      ${managed.length?'<button type="button" class="btn" id="tenantCompanySummary">Resumo da empresa</button>':''}
      ${possibleCatalogSources.length?'<button type="button" class="btn" id="tenantSharePart">Compartilhar catálogo</button>':''}
      ${possibleCatalogSources.length?'<button type="button" class="btn" id="tenantShareCustomer">Compartilhar cliente</button>':''}
      ${possibleCatalogSources.length?'<button type="button" class="btn" id="tenantTransferStock">Transferir estoque</button>':''}
      ${possibleCatalogSources.length?'<button type="button" class="btn" id="tenantStockHistory">Transferências / retomar</button>':''}
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
  const summary=$('#tenantCompanySummary');
  if(summary)summary.onclick=()=>{
    showModal('Resumo por empresa',`<form class="form-stack">
      <label>Empresa<select name="companyId">${companyOptions}</select></label>
      <button class="btn primary" type="submit">Consultar</button>
    </form>`,async fd=>{
      const id=Number(formObj(fd).companyId);
      const result=await api('/api/tenancy/company-summary?companyId='+id);
      const numbers=result.totals;
      showModal('Operação consolidada',`<div class="form-stack">
        <p class="muted">Somente unidades da empresa selecionada. Consolidação gerencial pelo livro financeiro canônico, sem substituir emissão fiscal ou contabilidade.</p>
        <div class="grid two-col">
          <div class="card"><strong>${numbers.customers}</strong><small> Clientes por unidade</small></div>
          <div class="card"><strong>${numbers.workOrders}</strong><small> Ordens de serviço</small></div>
          <div class="card"><strong>${numbers.openOrders}</strong><small> OS abertas</small></div>
          <div class="card"><strong>${numbers.parts}</strong><small> Cadastros de peças</small></div>
          <div class="card"><strong>${money(numbers.finance.receivedCents)}</strong><small> Recebimentos</small></div>
          <div class="card"><strong>${money(numbers.finance.expensesCents)}</strong><small> Despesas pagas</small></div>
          <div class="card"><strong>${money(numbers.finance.pendingCents)}</strong><small> A receber</small></div>
          <div class="card"><strong>${money(numbers.finance.resultCents)}</strong><small> Resultado caixa</small></div>
        </div>
        ${result.units.map(unit=>'<div class="list-item"><div><strong>'+esc(unit.name)+'</strong><br><small>Clientes: '+unit.customers+' · OS: '+unit.workOrders+' · Recebido: '+money(unit.finance.receivedCents)+' · Despesas: '+money(unit.finance.expensesCents)+'</small></div></div>').join('')}
      </div>`);
    });
  };

  const share=$('#tenantSharePart');
  if(share)share.onclick=async()=>{
    const choices=possibleCatalogSources.map(u=>'<option value="'+u.id+'">'+esc(u.companyName)+' / '+esc(u.name)+'</option>').join('');
    showModal('Compartilhar catálogo entre filiais',`<form class="form-stack">
      <p class="muted">Copia somente o cadastro da peça. Nenhum item de estoque, movimento ou saldo financeiro é transferido. Exige administrador nas duas unidades.</p>
      <label>Unidade de origem<select name="sourceUnitId" id="shareSourceUnit">${choices}</select></label>
      <label>Unidade de destino<select name="targetUnitId" id="shareTargetUnit" required></select></label>
      <label>Peça cadastrada<select name="partId" id="shareCatalogPart" required></select></label>
      <button type="submit" class="btn primary">Compartilhar cadastro</button>
    </form>`,async fd=>{
      const data=formObj(fd);
      const result=await api('/api/tenancy/share-part',{method:'POST',body:{
        sourceUnitId:Number(data.sourceUnitId),targetUnitId:Number(data.targetUnitId),partId:Number(data.partId)
      }});
      toast(result.created?'Cadastro compartilhado; estoque inicial zero':'Cadastro já compartilhado anteriormente');
    });
    const sourcePicker=$('#shareSourceUnit'),targetPicker=$('#shareTargetUnit'),partPicker=$('#shareCatalogPart');
    const load=async()=>{
      const source=managed.find(u=>String(u.id)===sourcePicker.value);
      targetPicker.replaceChildren();partPicker.replaceChildren();
      for(const unit of managed.filter(u=>u.companyId===source.companyId&&u.id!==source.id)){
        const option=document.createElement('option');option.value=String(unit.id);
        option.textContent=unit.name;targetPicker.append(option);
      }
      const result=await api('/api/tenancy/shareable-parts?unitId='+encodeURIComponent(sourcePicker.value));
      for(const part of result.parts||[]){
        const option=document.createElement('option');option.value=String(part.id);
        option.textContent=part.sku+' — '+part.description;partPicker.append(option);
      }
      if(!partPicker.options.length)toast('Nenhuma peça ativa encontrada na unidade de origem');
    };
    sourcePicker.onchange=()=>void load().catch(error=>toast(error.message,true));
    await load();
  };

  const shareCustomerBtn=$('#tenantShareCustomer');
  if(shareCustomerBtn)shareCustomerBtn.onclick=async()=>{
    const choices=possibleCatalogSources.map(u=>'<option value="'+u.id+'">'+esc(u.companyName)+' / '+esc(u.name)+'</option>').join('');
    showModal('Compartilhar cadastro de cliente',`<form class="form-stack">
      <p class="muted">Compartilhamento manual somente dentro da mesma empresa, com base legal e referência registradas em auditoria. Observações privadas, veículos e finanças não são copiados.</p>
      <label>Unidade de origem<select name="sourceUnitId" id="customerSourceUnit">${choices}</select></label>
      <label>Unidade de destino<select name="targetUnitId" id="customerTargetUnit" required></select></label>
      <label>Cliente<select name="customerId" id="customerShareId" required></select></label>
      <label>Base legal<select name="legalBasis" required>
        <option value="CONTRATO">Execução de contrato</option>
        <option value="CONSENTIMENTO">Consentimento documentado</option>
        <option value="LEGITIMO_INTERESSE">Legítimo interesse avaliado</option>
        <option value="OBRIGACAO_LEGAL">Obrigação legal</option>
      </select></label>
      <label>Referência da finalidade ou autorização<input name="recordReference" minlength="8" maxlength="120" required placeholder="Ex.: OS-2026-001 / autorização interna"></label>
      <button type="submit" class="btn primary">Compartilhar cadastro</button>
    </form>`,async fd=>{
      const data=formObj(fd);
      const result=await api('/api/tenancy/share-customer',{method:'POST',body:{
        sourceUnitId:Number(data.sourceUnitId),targetUnitId:Number(data.targetUnitId),customerId:Number(data.customerId),
        legalBasis:data.legalBasis,recordReference:data.recordReference
      }});
      toast(result.created?'Cliente copiado com trilha de auditoria':'Cliente já compartilhado anteriormente');
    });
    const sourcePicker=$('#customerSourceUnit'),targetPicker=$('#customerTargetUnit'),customerPicker=$('#customerShareId');
    const load=async()=>{
      const source=managed.find(u=>String(u.id)===sourcePicker.value);
      targetPicker.replaceChildren();customerPicker.replaceChildren();
      for(const unit of managed.filter(u=>u.companyId===source.companyId&&u.id!==source.id)){
        const option=document.createElement('option');option.value=String(unit.id);
        option.textContent=unit.name;targetPicker.append(option);
      }
      const result=await api('/api/tenancy/shareable-customers?unitId='+encodeURIComponent(sourcePicker.value));
      for(const customer of result.customers||[]){
        const option=document.createElement('option');option.value=String(customer.id);
        option.textContent=customer.name;customerPicker.append(option);
      }
      if(!customerPicker.options.length)toast('Nenhum cliente ativo encontrado na unidade de origem');
    };
    sourcePicker.onchange=()=>void load().catch(error=>toast(error.message,true));
    await load();
  };

  const transferStockButton=$('#tenantTransferStock');
  if(transferStockButton)transferStockButton.onclick=async()=>{
    const choices=possibleCatalogSources.map(u=>'<option value="'+u.id+'">'+esc(u.companyName)+' / '+esc(u.name)+'</option>').join('');
    const requestId=newCommandId();
    showModal('Transferência de estoque entre filiais',`<form class="form-stack">
      <p class="muted">Movimentação auditada com baixa e entrada no livro de estoque. Exige ADMIN nas duas unidades e cadastro da mesma peça no destino. Em falha parcial o estoque aparece como EM TRÂNSITO para retomada.</p>
      <label>Origem<select name="sourceUnitId" id="stockSourceUnit">${choices}</select></label>
      <label>Destino<select name="targetUnitId" id="stockTargetUnit" required></select></label>
      <label>Peça<select name="sourcePartId" id="stockSourcePart" required></select></label>
      <label>Quantidade<input name="quantity" type="number" min="0.001" step="0.001" max="1000000" required></label>
      <button class="btn primary" type="submit">Confirmar transferência</button>
    </form>`,async fd=>{
      const data=formObj(fd);
      const result=await api('/api/tenancy/stock-transfer',{method:'POST',body:{
        sourceUnitId:Number(data.sourceUnitId),targetUnitId:Number(data.targetUnitId),
        sourcePartId:Number(data.sourcePartId),quantity:Number(data.quantity),requestId
      }});
      toast(result.status==='COMPLETED'?'Estoque transferido e auditado':'Transferência #'+result.transferId+' em trânsito; abra Transferências / retomar');
    });
    const sourcePicker=$('#stockSourceUnit'),targetPicker=$('#stockTargetUnit'),partPicker=$('#stockSourcePart');
    const load=async()=>{
      const source=managed.find(u=>String(u.id)===sourcePicker.value);
      targetPicker.replaceChildren();partPicker.replaceChildren();
      for(const u of managed.filter(x=>x.companyId===source.companyId&&x.id!==source.id)){
        const option=document.createElement('option');option.value=String(u.id);
        option.textContent=u.name;targetPicker.append(option);
      }
      const result=await api('/api/tenancy/shareable-parts?unitId='+encodeURIComponent(sourcePicker.value));
      for(const part of result.parts||[]){
        if(!(Number(part.quantity)>0))continue;
        const option=document.createElement('option');option.value=String(part.id);
        option.textContent=part.sku+' — '+part.description+' ('+Number(part.quantity)+' '+part.unit+')';
        partPicker.append(option);
      }
      if(!partPicker.options.length)toast('Sem peças com estoque disponível nessa unidade',true);
    };
    sourcePicker.onchange=()=>void load().catch(error=>toast(error.message,true));
    await load();
  };
  const transfersButton=$('#tenantStockHistory');
  if(transfersButton)transfersButton.onclick=()=>{
    showModal('Transferências e recuperação',`<form class="form-stack">
      <label>Empresa<select name="companyId">${companyOptions}</select></label>
      <button class="btn primary" type="submit">Consultar transferências</button>
    </form>`,async fd=>{
      const companyId=Number(formObj(fd).companyId);
      const result=await api('/api/tenancy/stock-transfers?companyId='+companyId);
      showModal('Transferências recentes',`<div class="form-stack">
        <p class="muted">EM TRÂNSITO indica baixa já registrada na origem; retomar é idempotente. Apenas administradores autorizados nas duas unidades podem confirmar.</p>
        ${(result.transfers||[]).map(t=>'<div class="list-item"><div><strong>#'+t.transferId+' · '+esc(t.status)+'</strong><br><small>Unidade '+t.sourceUnitId+' → '+t.targetUnitId+' · '+t.quantity+' unidades</small></div>'+ (t.status==='PENDING'?'<button type="button" class="btn sm" data-stock-retry="'+t.transferId+'">Retomar</button>':'') +'</div>').join('')||'<p class="muted">Nenhuma transferência registrada.</p>'}
      </div>`);
      for(const button of document.querySelectorAll('[data-stock-retry]')){
        button.onclick=async()=>{
          const result=await api('/api/tenancy/stock-transfer/retry',{method:'POST',body:{transferId:Number(button.dataset.stockRetry)}});
          toast(result.status==='COMPLETED'?'Transferência concluída':'Transferência continua em trânsito');
          if(result.status==='COMPLETED'){button.disabled=true;button.textContent='Concluída';}
        };
      }
    });
  };
  const edit=$('#editTenantMember');
  if(edit)edit.onclick=async()=>{
    showModal('Alterar acesso de colaborador',`<form class="form-stack">
      <label>Unidade<select name="unitId" id="membershipUnit">${unitOptions}</select></label>
      <label>Colaborador<select name="userId" id="membershipUser" required></select></label>
      <label>Papel<select name="role"><option>ATENDIMENTO</option><option>TECNICO</option><option>FINANCEIRO</option><option>ADMIN</option></select></label>
      <label>Status<select name="active"><option value="true">Ativo</option><option value="false">Revogar acesso</option></select></label>
      <button class="btn primary" type="submit">Atualizar vínculo</button>
    </form>`,async fd=>{
      const data=formObj(fd);
      await api('/api/tenancy/memberships',{method:'PATCH',body:{unitId:Number(data.unitId),userId:Number(data.userId),role:data.role,active:data.active==='true'}});
      toast('Acesso atualizado');location.reload();
    });
    const unitPicker=$('#membershipUnit'),userPicker=$('#membershipUser');
    const load=async()=>{
      const members=await api('/api/tenancy/memberships?unitId='+encodeURIComponent(unitPicker.value));
      userPicker.replaceChildren();
      for(const member of members){
        const option=document.createElement('option');option.value=String(member.id);
        option.textContent=member.name+' — '+member.role+(member.membershipActive?'':' (revogado)');
        userPicker.append(option);
      }
    };
    unitPicker.onchange=()=>void load().catch(error=>toast(error.message,true));
    await load();
  };
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
for(const id of ['tenantManageBtn','mobileTenantManageBtn']){
  const manageTenancy=document.getElementById(id);
  if(manageTenancy)manageTenancy.onclick=()=>void openTenantAdmin().catch(error=>toast(error.message,true));
}
