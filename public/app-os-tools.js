// Extensão explícita da OS: não sobrescreve funções globais nem repete GET da OS.
async function enhanceWorkOrderModal(id,os){
  const host=$('#modalBody'); if(!host)return;
  const bar=document.createElement('div'); bar.className='detail-block'; bar.style.marginBottom='14px';
  const canEdit=['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user?.role);
  const canDuplicate=['ADMIN','ATENDIMENTO'].includes(state.user?.role);
  bar.innerHTML=`<div class="card-head"><div><h3 style="margin:0">Ações da OS</h3><small class="muted">Correções ficam registradas no histórico</small></div><div class="action-row">${canEdit?'<button class="btn sm primary" id="editFullOS">Editar OS</button>':''}${canDuplicate?'<button class="btn sm" id="duplicateOS">Duplicar OS</button>':''}<button class="btn sm" id="historyOS">Histórico</button><button class="btn sm soft" id="pdfOS">Gerar PDF</button></div></div>`;
  host.prepend(bar);
  if($('#editFullOS'))$('#editFullOS').onclick=()=>editFullWorkOrder(id);
  if($('#duplicateOS'))$('#duplicateOS').onclick=()=>duplicateWorkOrderUi(id);
  $('#historyOS').onclick=()=>showWorkOrderHistory(id);
  $('#pdfOS').onclick=()=>downloadWorkOrderPdf(id,os.os_number);
}

function localDateTimeValue(value){
  if(!value)return ''; const d=new Date(value); if(Number.isNaN(d.getTime()))return '';
  const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function machineLabel(m){return [m.brand,m.model,m.type,m.internal_id?`(${m.internal_id})`:''].filter(Boolean).join(' ')}
function machineOptions(machines,customerId,selected){return machines.filter(m=>String(m.customer_id)===String(customerId)).map(m=>`<option value="${m.id}" ${String(m.id)===String(selected)?'selected':''}>${esc(machineLabel(m))}</option>`).join('')}

async function editFullWorkOrder(id){
  const [os,customers,machines,techs]=await Promise.all([api(`/api/work-orders/${id}`),api('/api/customers?includeInactive=1'),api('/api/machines?includeInactive=1'),api('/api/technicians')]);
  showModal(`Editar OS #${os.os_number}`,`<form class="form-stack">
    <div class="field-row"><label>Cliente<select name="customerId" id="editOsCustomer" required>${customers.map(c=>`<option value="${c.id}" ${c.id===os.customer_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Equipamento<select name="machineId" id="editOsMachine" required>${machineOptions(machines,os.customer_id,os.machine_id)}</select></label></div>
    <label>Problema relatado<textarea name="problemReported" required>${esc(os.problem_reported)}</textarea></label>
    <label>Diagnóstico<textarea name="diagnosis">${esc(os.diagnosis)}</textarea></label>
    <div class="field-row"><label>Técnico<select name="technicianId"><option value="">Não definido</option>${techs.map(t=>`<option value="${t.id}" ${t.id===os.technician_id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>Prioridade<select name="priority">${['BAIXA','NORMAL','ALTA','URGENTE'].map(p=>`<option ${p===os.priority?'selected':''}>${p}</option>`).join('')}</select></label></div>
    <div class="field-row"><label>Data de entrada<input type="datetime-local" name="enteredAt" value="${localDateTimeValue(os.entered_at)}" required></label><label>Previsão de entrega<input type="datetime-local" name="estimatedDelivery" value="${localDateTimeValue(os.estimated_delivery)}"></label></div>
    <label>Observações internas<textarea name="internalNotes">${esc(os.internal_notes)}</textarea></label>
    <div class="card"><small>Alterações de cliente, equipamento, problema, diagnóstico, técnico, datas, prioridade e observações serão registradas com usuário, data/hora, valor anterior e novo.</small></div>
    <button class="btn primary" type="submit">Salvar alterações</button>
  </form>`,async fd=>{
    const o=formObj(fd); const body={customerId:Number(o.customerId),machineId:Number(o.machineId),problemReported:o.problemReported,diagnosis:o.diagnosis,technicianId:o.technicianId?Number(o.technicianId):null,priority:o.priority,enteredAt:new Date(o.enteredAt).toISOString(),estimatedDelivery:o.estimatedDelivery?new Date(o.estimatedDelivery).toISOString():null,internalNotes:o.internalNotes};
    await api(`/api/work-orders/${id}`,{method:'PATCH',body}); toast('OS atualizada e alteração registrada'); await renderWorkOrders();
  });
  $('#editOsCustomer').onchange=e=>{const opts=machineOptions(machines,e.target.value,null);$('#editOsMachine').innerHTML=opts||'<option value="">Nenhuma equipamento deste cliente</option>'};
}

async function showWorkOrderHistory(id){
  const [os,history,customers,machines,techs]=await Promise.all([api(`/api/work-orders/${id}`),api(`/api/work-orders/${id}/history`),api('/api/customers?includeInactive=1'),api('/api/machines?includeInactive=1'),api('/api/technicians')]);
  const customerMap=Object.fromEntries(customers.map(x=>[String(x.id),x.name])); const machineMap=Object.fromEntries(machines.map(x=>[String(x.id),machineLabel(x)])); const techMap=Object.fromEntries(techs.map(x=>[String(x.id),x.name]));
  const labels={customer_id:'Cliente',machine_id:'Equipamento',entered_at:'Data de entrada',problem_reported:'Problema relatado',diagnosis:'Diagnóstico',technician_id:'Técnico',estimated_delivery:'Previsão de entrega',priority:'Prioridade',internal_notes:'Observações internas'};
  const pretty=(field,value)=>{if(value==null||value==='')return '—';if(field==='customer_id')return customerMap[value]||`#${value}`;if(field==='machine_id')return machineMap[value]||`#${value}`;if(field==='technician_id')return techMap[value]||`#${value}`;if(['entered_at','estimated_delivery'].includes(field))return dt(value);return value};
  const rows=history.slice().reverse().map(h=>h.type==='STATUS'
    ? `<div class="list-item"><div><strong>Status: ${esc(pretty(null,h.old_value))} → ${esc(pretty(null,h.new_value))}</strong>${h.reason?`<br><small>${esc(h.reason)}</small>`:''}<br><small>${esc(h.changed_by_name||'Sistema')} · ${dt(h.changed_at)}</small></div></div>`
    : `<div class="list-item"><div><strong>${esc(labels[h.field]||h.field)}</strong><br><span>${esc(pretty(h.field,h.old_value))} → ${esc(pretty(h.field,h.new_value))}</span><br><small>${esc(h.changed_by_name||'Sistema')} · ${dt(h.changed_at)}</small></div></div>`).join('');
  showModal(`Histórico da OS #${os.os_number}`,`<div class="list">${rows||'<div class="empty">Nenhuma alteração registrada.</div>'}</div>`);
}

async function downloadWorkOrderPdf(id,number){
  try{
    const res=await fetch(`/api/work-orders/${id}/documents/work-order/pdf`,{headers:{Authorization:`Bearer ${state.token}`}}); if(!res.ok){let msg=await res.text();try{msg=JSON.parse(msg).error}catch{}throw new Error(msg)}
    const blob=await res.blob(); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`OS-${number}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('PDF da OS gerado');
  }catch(e){toast(e.message,true)}
}

async function duplicateWorkOrderUi(id){
  const safe=async p=>{try{return await api(p)}catch{return null}};
  const [os,quote,customers,machines]=await Promise.all([api(`/api/work-orders/${id}`),safe(`/api/work-orders/${id}/quote`),api('/api/customers'),api('/api/machines')]);
  showModal(`Duplicar OS #${os.os_number}`,`<form class="form-stack">
    <div class="card"><strong>Será criada uma nova OS independente, com novo número.</strong><br><small>Pagamentos, recebimentos, peças baixadas e movimentações de estoque não serão copiados.</small></div>
    <div class="field-row"><label>Novo cliente<select name="customerId" id="dupCustomer" required>${customers.map(c=>`<option value="${c.id}" ${c.id===os.customer_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Equipamento<select name="machineId" id="dupMachine" required>${machineOptions(machines,os.customer_id,os.machine_id)}</select></label></div>
    <label>Problema/serviço base<textarea name="problemReported" required>${esc(os.problem_reported)}</textarea></label>
    <label>Diagnóstico/descrição reutilizável<textarea name="diagnosis">${esc(os.diagnosis)}</textarea></label>
    <label>Observações internas<textarea name="internalNotes">${esc(os.internal_notes)}</textarea></label>
    ${quote?'<label><input type="checkbox" name="copyQuote" checked style="width:auto"> Copiar serviços/itens do orçamento como rascunho</label>':''}
    <button class="btn primary" type="submit">Criar nova OS</button>
  </form>`,async fd=>{
    const o=formObj(fd); const created=await api('/api/work-orders',{method:'POST',body:{customerId:Number(o.customerId),machineId:Number(o.machineId),problemReported:o.problemReported,diagnosis:o.diagnosis,technicianId:os.technician_id||undefined,priority:os.priority,internalNotes:o.internalNotes}});
    if(quote&&fd.get('copyQuote')){
      await api(`/api/work-orders/${created.id}/status`,{method:'POST',body:{status:'DIAGNOSTICO',reason:'Preparação de orçamento reutilizado'}});
      await api(`/api/work-orders/${created.id}/quote`,{method:'PUT',body:{discountCents:quote.discount_cents,validUntil:null,notes:quote.notes,items:quote.items.map(i=>({kind:i.kind,description:i.description,quantity:i.quantity,unitPriceCents:i.unit_price_cents}))}});
    }
    toast(`Nova OS #${created.os_number} criada`); await renderWorkOrders();
  });
  $('#dupCustomer').onchange=e=>{const opts=machineOptions(machines,e.target.value,null);$('#dupMachine').innerHTML=opts||'<option value="">Nenhuma equipamento deste cliente</option>'};
}
