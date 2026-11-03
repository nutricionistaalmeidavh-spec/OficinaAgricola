async function renderCustomers(){pageTitle('Clientes','CADASTROS');const rows=await api('/api/customers?includeInactive=1');setContent(`<div class="section-head"><div><h2>Clientes cadastrados</h2><span class="muted">${rows.length} registros</span></div>${['ADMIN','ATENDIMENTO'].includes(state.user.role)?'<button id="newCustomer" class="btn primary">+ Novo cliente</button>':''}</div>${table(['Cliente','CPF/CNPJ','Telefone','Situação',''],rows.map(c=>[`<strong>${esc(c.name)}</strong>`,esc(c.document||'—'),esc(c.phone||'—'),c.active?badge('ATIVO'):badge('INATIVO'),`${['ADMIN','ATENDIMENTO'].includes(state.user.role)?`<button class="btn sm" data-edit-customer="${c.id}">Editar</button>`:""}`]))}`);if($('#newCustomer'))$('#newCustomer').onclick=()=>customerModal();document.querySelectorAll('[data-edit-customer]').forEach(b=>b.onclick=async()=>customerModal(await api(`/api/customers/${b.dataset.editCustomer}`)))}
function customerModal(c={}){const requestId=newCommandId();showModal(c.id?'Editar cliente':'Novo cliente',`<form class="form-stack"><div class="field-row"><label>Nome / Razão social<input name="name" required value="${esc(c.name||'')}"></label><label>CPF/CNPJ<input name="document" value="${esc(c.document||'')}"></label></div><div class="field-row"><label>Telefone<input name="phone" value="${esc(c.phone||'')}"></label><label>E-mail<input name="email" type="email" value="${esc(c.email||'')}"></label></div><label>Endereço<input name="address" value="${esc(c.address||'')}"></label><label>Observações<textarea name="notes">${esc(c.notes||'')}</textarea></label>${c.id?`<label><select name="active"><option value="1" ${c.active?'selected':''}>Ativo</option><option value="0" ${!c.active?'selected':''}>Inativo</option></select></label>`:''}<button class="btn primary" type="submit">Salvar</button></form>`,async fd=>{const o=formObj(fd);if('active'in o)o.active=o.active==='1';await api(c.id?`/api/customers/${c.id}`:'/api/customers',{method:c.id?'PATCH':'POST',body:{...o,requestId}});toast('Cliente salvo');await refreshCurrentPage()})}

let activeWorkshopProfile='MISTA';
async function renderMachines(){const [machines,customers,company]=await Promise.all([api('/api/machines?includeInactive=1'),api('/api/customers'),api('/api/company')]);
activeWorkshopProfile=company.service_profile||'MISTA';
pageTitle(activeWorkshopProfile==='AUTOMOTIVA'?'Veículos':activeWorkshopProfile==='AGRICOLA'?'Máquinas':'Equipamentos','CADASTROS');setContent(`<div class="section-head"><div><h2>Equipamentos cadastrados</h2><span class="muted">Histórico por equipamento</span></div>${['ADMIN','ATENDIMENTO'].includes(state.user.role)?`<button id="newMachine" class="btn primary">+ Novo equipamento</button>`:''}</div>${table(['Equipamento','Cliente','Placa / Chassi','Km / Horas','Situação',''],machines.map(m=>[`<strong>${esc([m.brand,m.model].filter(Boolean).join(' ')||m.type)}</strong><br><small>${esc(m.type)}</small>`,esc(m.customer_name),esc(m.license_plate||m.vin||m.serial_number||m.internal_id||'—'),(m.odometer_km==null?`${m.hour_meter} h`:`${m.odometer_km} km`),m.active?badge('ATIVO'):badge('INATIVO'),`${['ADMIN','ATENDIMENTO'].includes(state.user.role)?`<button class="btn sm" data-edit-machine="${m.id}">Editar</button>`:''} <button class="btn sm" data-history="${m.id}">Histórico</button>`]))}`);if($('#newMachine'))$('#newMachine').onclick=()=>machineModal(customers);$$('[data-history]').forEach(b=>b.onclick=()=>machineHistoryModal(b.dataset.history));$$('[data-edit-machine]').forEach(b=>b.onclick=async()=>machineModal(customers,await api(`/api/machines/${b.dataset.editMachine}`)))}
function machineModal(customers,m={}){const requestId=newCommandId();showModal(m.id?'Editar equipamento':'Novo equipamento',`<form class="form-stack"><label>Cliente<select name="customerId" required><option value="">Selecione</option>${customers.map(c=>`<option value="${c.id}" ${Number(m.customer_id)===Number(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><div class="field-row three"><label>Tipo<input name="type" required placeholder="Carro, caminhão, trator..." value="${esc(m.type||'')}"></label><label>Marca<input name="brand" value="${esc(m.brand||'')}"></label><label>Modelo<input name="model" value="${esc(m.model||'')}"></label></div><div class="field-row three"><label>Ano<input name="year" type="number" value="${esc(m.year??'')}"></label><label>Nº de série/IMEI<input name="serialNumber" value="${esc(m.serial_number||'')}"></label><label>Uso/Horas<input name="hourMeter" type="number" step="0.1" value="${m.hour_meter??0}"></label></div><div class="field-row three"><label>Placa<input name="plate" maxlength="8" placeholder="ABC1D23" value="${esc(m.license_plate||'')}"></label><label>VIN / Chassi<input name="vin" maxlength="17" placeholder="17 caracteres" value="${esc(m.vin||'')}"></label><label>Quilometragem<input name="odometerKm" type="number" min="0" step="1" value="${esc(m.odometer_km??'')}"></label></div><div class="field-row three"><label>RENAVAM<input name="renavam" inputmode="numeric" maxlength="11" pattern="[0-9]{11}" placeholder="11 dígitos" value="${esc(m.renavam||'')}"></label><label>Motorização<input name="engine" maxlength="100" placeholder="1.6 MSI, 2.0 Turbo..." value="${esc(m.engine||'')}"></label><label>Combustível<select name="fuelType"><option value="">Não informado</option>${['GASOLINA','ETANOL','FLEX','DIESEL','GNV','ELETRICO','HIBRIDO','OUTRO'].map(v=>`<option value="${v}" ${m.fuel_type===v?'selected':''}>${v}</option>`).join('')}</select></label></div><label>Observações<textarea name="notes">${esc(m.notes||'')}</textarea></label><button class="btn primary" type="submit">Salvar equipamento</button></form>`,async fd=>{const o=formObj(fd);o.customerId=Number(o.customerId);o.hourMeter=Number(o.hourMeter||0);if(o.year)o.year=Number(o.year);await api(m.id?`/api/machines/${m.id}`:'/api/machines',{method:m.id?'PATCH':'POST',body:{...o,requestId}});toast('Equipamento salvo');await refreshCurrentPage()})}
async function machineHistoryModal(id){
 const [m,h,records,plans,scans,compatible]=await Promise.all([
   api(`/api/machines/${id}`),api(`/api/machines/${id}/history`),
   api(`/api/machines/${id}/maintenance`),api(`/api/machines/${id}/maintenance-plans`),
   api(`/api/machines/${id}/obd-scans`),api(`/api/machines/${id}/compatible-parts`)
 ]);
 const history=h.length?`<div class="list">${h.map(o=>`<div class="list-item"><div><strong>OS #${o.os_number} ${badge(o.status)}</strong><p>${esc(o.problem_reported)}</p><small>${esc(o.diagnosis||'Sem diagnóstico')}</small></div><div>${dt(o.entered_at)}<br><strong>${money(o.quote_total_cents)}</strong></div></div>`).join('')}</div>`:'<div class="empty">Sem ordens de serviço.</div>';
 const maintenance=records.length?`<div class="list">${records.map(r=>`<div class="list-item"><div><strong>${esc(r.kind==='REVISAO'?'Revisão':'Garantia')}</strong><small> ${esc(r.performed_at||r.warranty_until||'')} ${r.os_number?' · OS #'+r.os_number:''}</small><p>${esc(r.notes||'')}</p></div><small>${r.next_due_km!=null?'Próx.: '+r.next_due_km+' km':''} ${esc(r.next_due_date||'')}</small></div>`).join('')}</div>`:'<div class="empty">Nenhuma revisão ou garantia registrada.</div>';
 const plansHtml=plans.length?plans.map(p=>`<div class="list-item"><div><strong>${esc(p.name)}</strong><br><small>Próxima: ${esc(p.next_due_date||'—')} · ${p.next_due_km??'—'} km · ${p.next_due_hours??'—'} h</small></div><button class="btn sm" data-complete-plan="${p.id}">Registrar execução</button></div>`).join(''):'<div class="empty">Nenhum plano preventivo.</div>';
 const scansHtml=scans.length?scans.slice(0,12).map(s=>`<div class="list-item"><div><strong>${esc(s.created_at.slice(0,10))}</strong> · ${esc(s.protocol)} ${s.source==='SIMULATED'?badge('SIMULADO'):''}<br><small>${esc(JSON.parse(s.codes_json).join(', ')||'Sem DTCs registrados')}</small></div><div class="action-row"><button class="btn sm" data-diagnostic-id="${s.id}">Detalhes</button><button class="btn sm" data-download-diagnostic="${s.id}">PDF</button></div></div>`).join(''):'<div class="empty">Nenhuma leitura OBD-II armazenada.</div>';
 const fitmentHtml=compatible.length?compatible.map(p=>`<div class="list-item"><strong>${esc(p.sku)} · ${esc(p.description)}</strong><small>Estoque: ${p.quantity}</small></div>`).join(''):'<div class="empty">Sem aplicações de peças cadastradas para este veículo.</div>';
 const canRecord=['ADMIN','ATENDIMENTO'].includes(state.user.role);
 const canDiag=['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role);
 showModal(`Histórico — ${m.brand} ${m.model}`,`<div class="action-row">${canRecord?`<button class="btn sm" id="newReview">+ Revisão</button><button class="btn sm" id="newWarranty">+ Garantia</button><button class="btn sm" id="newMaintenancePlan">+ Plano preventivo</button>`:``}${canDiag?`<button class="btn sm" id="newObdScan">Ler OBD-II</button>`:``}</div>
 <h3>Histórico de OS</h3>${history}<h3>Revisões e garantias</h3>${maintenance}
 <h3>Planos de manutenção</h3><div class="list">${plansHtml}</div>
 <h3>Diagnósticos OBD-II</h3><div class="list">${scansHtml}</div>
 <h3>Peças com aplicação cadastrada</h3><p class="muted">Aplicação informada pela oficina; confira catálogo do fabricante antes da montagem.</p><div class="list">${fitmentHtml}</div>`);
 if(canRecord)$('#newReview').onclick=()=>maintenanceModal(id,'REVISAO',h);
 if(canRecord)$('#newWarranty').onclick=()=>maintenanceModal(id,'GARANTIA',h);
 if(canRecord)$('#newMaintenancePlan').onclick=()=>maintenancePlanModal(id,m);
 if(canDiag)$('#newObdScan').onclick=()=>diagnosticCaptureModal(id);
 $$('[data-complete-plan]').forEach(b=>b.onclick=()=>completeMaintenancePlanModal(Number(b.dataset.completePlan),id,m,h));
 $$('[data-diagnostic-id]').forEach(b=>b.onclick=()=>diagnosticDetailModal(id,scans.find(s=>String(s.id)===b.dataset.diagnosticId)));
 $$('[data-download-diagnostic]').forEach(b=>b.onclick=async()=>{try{await diagnosticDownload(id,Number(b.dataset.downloadDiagnostic))}catch(e){toast(e.message,true)}});
}
function maintenanceModal(machineId,kind,orders=[]){const requestId=newCommandId();
 const review=kind==='REVISAO';
 showModal(review?'Registrar revisão':'Registrar garantia',`<form class="form-stack">
   ${review?'<label>Data da revisão<input name="performedAt" type="date" required></label><label>Próxima revisão<input name="nextDueDate" type="date"></label><label>Próxima revisão (km)<input name="nextDueKm" type="number" min="0"></label>':'<label>Garantia válida até<input name="warrantyUntil" type="date" required></label>'}
   ${workOrderSelector(orders)}
   <label>Detalhes<textarea name="notes" maxlength="2000"></textarea></label>
   <button type="submit" class="btn primary">Registrar</button></form>`,async fd=>{
     const o=formObj(fd);
     if(!o.workOrderId)delete o.workOrderId;
     if(!o.nextDueKm)delete o.nextDueKm;
     await api(`/api/machines/${machineId}/maintenance`,{method:'POST',body:{...o,kind,requestId}});
     toast(review?'Revisão registrada':'Garantia registrada');
     await machineHistoryModal(machineId);
   });
}




function maintenancePlanModal(machineId,m){
  const requestId=newCommandId();
  showModal('Plano de manutenção preventiva', '<form class="form-stack">'+
  '<label>Serviço recorrente<input name="name" required maxlength="120" placeholder="Óleo e filtros, correia, lubrificação..."></label>'+
  '<div class="field-row three"><label>Intervalo (dias)<input type="number" min="1" step="1" name="intervalDays"></label>'+
  '<label>Intervalo (km)<input type="number" min="1" name="intervalKm"></label>'+
  '<label>Intervalo (horas)<input type="number" min="1" name="intervalHours"></label></div>'+
  '<div class="field-row three"><label>Data de referência<input type="date" name="startingDate" value="'+new Date().toISOString().slice(0,10)+'"></label>'+
  '<label>Km de referência<input type="number" min="0" name="startingKm" value="'+esc(m.odometer_km??'')+'"></label>'+
  '<label>Horímetro inicial<input type="number" min="0" name="startingHours" value="'+esc(m.hour_meter??0)+'"></label></div>'+
  '<label>Observações<textarea name="notes" maxlength="500"></textarea></label>'+
  '<p class="muted">O alerta é calculado localmente a partir de tempo, km e/ou horas. Não exige internet.</p>'+
  '<button type="submit" class="btn primary">Cadastrar plano</button></form>',async fd=>{
    const o=formObj(fd);
    for(const key of ['intervalDays','intervalKm','intervalHours','startingKm','startingHours']){
      if(o[key]==='')delete o[key];else o[key]=Number(o[key]);
    }
    await api('/api/machines/'+machineId+'/maintenance-plans',{method:'POST',body:{...o,requestId}});
    toast('Plano registrado');await machineHistoryModal(machineId);
  });
}
function completeMaintenancePlanModal(planId,machineId,m,orders=[]){
  const requestId=newCommandId();
  showModal('Registrar manutenção executada','<form class="form-stack">'+
    '<label>Data<input name="performedAt" type="date" required value="'+new Date().toISOString().slice(0,10)+'"></label>'+
    '<div class="field-row"><label>Km atual<input type="number" name="odometerKm" min="0" value="'+esc(m.odometer_km??'')+'"></label>'+
    '<label>Horímetro<input type="number" name="hourMeter" min="0" value="'+esc(m.hour_meter??0)+'"></label></div>'+
    workOrderSelector(orders,{label:'OS correspondente (opcional)'})+
    '<button type="submit" class="btn primary">Concluir e recalcular próxima revisão</button></form>',async fd=>{
      const o=formObj(fd);
      for(const k of ['odometerKm','hourMeter','workOrderId']){
        if(o[k]==='')delete o[k];else o[k]=Number(o[k]);
      }
      await api('/api/maintenance-plans/'+planId+'/complete',{method:'POST',body:{...o,requestId}});
      toast('Revisão registrada; próxima manutenção recalculada');await machineHistoryModal(machineId);
    });
}
async function obdScanModal(machineId){
  const orders=await api('/api/machines/'+machineId+'/history');
  showModal('Diagnóstico OBD-II (somente leitura)', '<div class="form-stack">'+
    '<p>Conecte o adaptador ELM327 USB/serial ao veículo e ligue a ignição. Leitura do serviço 03 (DTCs armazenados); não apaga falhas nem altera a ECU.</p>'+
    '<label>Velocidade serial<select id="obdBaud"><option value="38400">38400 (padrão ELM327)</option><option value="9600">9600</option><option value="115200">115200</option></select></label>'+
    workOrderSelector(orders,{id:'obdWorkOrder',label:'OS correspondente (opcional)'})+
    '<details><summary>Requisitos técnicos da conexão</summary><p class="muted">Disponível em navegador Chromium compatível em localhost/HTTPS ou Electron com permissão de porta. Exige hardware físico; não usa serviço pago.</p></details>'+
    '<div id="obdProgress" role="status"></div><button type="button" id="obdRead" class="btn primary">Conectar adaptador e ler códigos</button></div>');
  $('#obdRead').onclick=async()=>{
    const button=$('#obdRead'),progress=$('#obdProgress');button.disabled=true;
    progress.textContent='Solicitando porta serial e consultando ECU...';
    try{
      const {rawResponse,protocol}=await readElm327StoredDtc(Number($('#obdBaud').value));
      const os=Number($('#obdWorkOrder').value);
      const saved=await api('/api/machines/'+machineId+'/obd-scans',{method:'POST',body:{
        protocol:'ELM327 '+protocol,rawResponse,
        ...(os?{workOrderId:os}:{}),requestId:newCommandId()}});
      const codes=JSON.parse(saved.codes_json);
      toast(codes.length?'Códigos registrados: '+codes.join(', '):'Leitura registrada: sem DTCs');
      await machineHistoryModal(machineId);
    }catch(error){progress.textContent=friendlyUiMessage(error.message);button.disabled=false;toast(error.message,true)}
  };
}
