// Consulta paginada: nunca procurar apenas nos primeiros cadastros do banco.
function bindPagedSelector({select,search,more,notice,path,label,onChange,extra={},empty='Selecione',allowNew=false}){
  let epoch=0,cursor=null,rows=[];
  const selected=new Map([...select.options].filter(o=>o.value&&o.value!=='new').map(o=>[o.value,o.textContent]));
  const load=async(append=false)=>{
    const own=++epoch,query=new URLSearchParams({...extra,search:search.value.trim(),limit:'50'});
    if(append&&cursor)query.set('cursor',cursor);
    more.disabled=true;notice.textContent='Consultando cadastros…';
    try{
      const page=await api(path+'?'+query);
      if(own!==epoch||!select.isConnected)return;
      const value=select.value;
      rows=append?rows.concat(page.items):page.items;
      if(value&&value!=='new')selected.set(value,select.selectedOptions[0]?.textContent||value);
      const choices=new Map(rows.map(row=>[String(row.id),label(row)]));
      if(selected.has(value))choices.set(value,selected.get(value));
      renderRegion(select,`<option value="">${esc(empty)}</option>`+
        [...choices].map(([id,text])=>`<option value="${esc(id)}">${esc(text)}</option>`).join('')+
        (allowNew?'<option value="new">+ Cadastrar agora</option>':''));
      select.value=value;
      cursor=page.nextCursor;more.hidden=!cursor;
      notice.textContent=page.total?`${rows.length} de ${page.total} resultado(s)`:'Nenhum cadastro encontrado. Refine a busca ou cadastre agora.';
    }catch(error){
      if(own===epoch&&select.isConnected){notice.textContent='Consulta indisponível. Seus dados foram mantidos. Tente novamente.';more.hidden=false;more.textContent='Tentar novamente';}
      if(error.name!=='AbortError')toast(error.message,true);
    }finally{if(own===epoch)more.disabled=false;}
  };
  search.oninput=()=>{void load();};
  more.onclick=()=>{void load(Boolean(cursor));};
  select.onchange=()=>onChange?.(select.value);
  return {load,cancel:()=>{epoch++;cursor=null;},update:values=>{extra={...extra,...values};cursor=null;return load();}};
}

async function openNewWorkOrder(){
  try{
    const [page,techs]=await Promise.all([api('/api/customers/page?limit=50'),api('/api/technicians')]);
    workOrderModal(page.items,[],techs);
  }catch(error){toast(error.message,true);}
}

function workOrderEntryForm(customers,techs){
  return `<form class="form-stack">
    <label>Buscar cliente<input id="osCustomerSearch" type="search" placeholder="Nome, documento ou telefone"></label>
    <label>Cliente<select name="customerId" id="osCustomer" required><option value="">Selecione</option>${customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="new">+ Cadastrar agora</option></select></label>
    <small id="osCustomerNotice" role="status"></small><button id="osCustomerMore" type="button" class="btn sm" hidden>Carregar mais clientes</button>
    <fieldset id="osNewCustomer" hidden disabled><legend>Novo cliente</legend>
      <label>Nome / Razão social<input name="newCustomerName" required></label><label>Telefone<input name="newCustomerPhone" type="tel"></label>
      <p class="muted">O cliente será cadastrado ao abrir a OS.</p></fieldset>
    <label>Buscar veículo ou equipamento<input id="osMachineSearch" type="search" placeholder="Placa, chassi, modelo ou série" disabled></label>
    <label>Veículo / equipamento<select name="machineId" id="osMachine" required><option value="">Selecione o cliente</option></select></label>
    <small id="osMachineNotice" role="status"></small><button id="osMachineMore" type="button" class="btn sm" hidden>Carregar mais equipamentos</button>
    <fieldset id="osNewMachine" hidden disabled><legend>Novo veículo / equipamento</legend>
      <label>Tipo<input name="newMachineType" required placeholder="Carro, caminhão, trator…"></label>
      <div class="field-row"><label>Marca<input name="newMachineBrand"></label><label>Modelo<input name="newMachineModel"></label></div>
      <label>Placa (se houver)<input name="newMachinePlate" maxlength="8"></label></fieldset>
    <label>Problema relatado<textarea name="problemReported" required></textarea></label>
    <div class="field-row"><label>Técnico<select name="technicianId"><option value="">Não definido</option>${techs.filter(t=>t.active).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <label>Prioridade<select name="priority"><option>NORMAL</option><option>ALTA</option><option>URGENTE</option><option>BAIXA</option></select></label></div>
    <label>Previsão de entrega<input type="datetime-local" name="estimatedDelivery"></label>
    <button class="btn primary" type="submit">Abrir OS</button></form>`;
}

async function saveWorkOrderDiagnosis(event,id,os){
  event.preventDefault();
  const form=event.currentTarget,button=$('button[type=submit]',form),input=$('textarea',form);
  if(button.disabled||modalSession?.busy)return;
  const token=state.modalToken;
  button.disabled=true;input.readOnly=true;form.setAttribute('aria-busy','true');
  if(modalSession)modalSession.busy=true;
  let errorBox=$('[data-diagnosis-error]',form);
  if(!errorBox){errorBox=document.createElement('div');errorBox.dataset.diagnosisError='';errorBox.setAttribute('role','alert');form.appendChild(errorBox);}
  errorBox.replaceChildren();
  try{
    const saved=await api(`/api/work-orders/${id}`,{method:'PATCH',body:{diagnosis:input.value,expectedVersion:os.version}});
    Object.assign(os,saved);
    dirtyInputs.delete(input);
    if(state.modalToken===token&&modalSession)modalSession.dirty=false;
    toast(`Diagnóstico da OS #${os.os_number} salvo`);
  }catch(error){
    errorBox.textContent=friendlyUiMessage(error.message);
    if(error.status===409){
      const review=document.createElement('button');review.type='button';review.className='btn sm';review.textContent='Revisar versão atual sem perder meu texto';
      review.onclick=async()=>{
        review.disabled=true;
        try{
          const current=await api(`/api/work-orders/${id}`);
          if(state.modalToken!==token)return;
          if(confirm(`Diagnóstico registrado no servidor:\n${current.diagnosis||'(vazio)'}\n\nManter seu texto para salvar sobre esta versão?`))Object.assign(os,current);
        }catch(cause){toast(cause.message,true);}finally{review.disabled=false;}
      };
      errorBox.appendChild(review);
    }
    toast(error.message,true);
  }finally{
    button.disabled=false;input.readOnly=false;form.removeAttribute('aria-busy');
    if(state.modalToken===token&&modalSession)modalSession.busy=false;
  }
}

async function changeWorkOrderStatus(button,id,os){
  if(button.disabled||modalSession?.busy)return;
  if(modalSession?.dirty){toast('Salve as alterações antes de mudar a etapa da OS.',true);return;}
  const status=button.dataset.status;
  let reason='';
  if(status==='CANCELADA'||os.status==='PRONTA'&&status==='EM_SERVICO'){
    const value=prompt(status==='CANCELADA'?'Motivo do cancelamento da OS:':'Motivo do retorno ao serviço:');
    if(!value?.trim())return;reason=value.trim();
    if(status==='CANCELADA'&&!confirm('Cancelar a OS? Peças e recebimentos precisam estar estornados.'))return;
  }
  button.disabled=true;
  if(modalSession)modalSession.busy=true;
  try{
    await api(`/api/work-orders/${id}/status`,{method:'POST',body:{status,reason,expectedVersion:os.version,requestId:button.dataset.commandId||=(newCommandId())}});
    toast(`OS #${os.os_number} atualizada`);closeModal();await refreshCurrentPage();
  }catch(error){
    toast(error.message,true);
    if(error.status===409){
      const form=$('#modalBody'),retry=document.createElement('button');
      retry.type='button';retry.className='btn sm';retry.textContent='Consultar OS atual';
      retry.onclick=()=>openWorkOrder(id).catch(cause=>toast(cause.message,true));form?.appendChild(retry);
    }
  }finally{button.disabled=false;if(modalSession)modalSession.busy=false;}
}
