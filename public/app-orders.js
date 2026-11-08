
function orderColumns(flow){return flow.map(group=>[group.statuses[0],group.label]);}
const OS_CLOSED_STATUSES=['ENTREGUE','CANCELADA','REPROVADA','TRANSFERIDA'];
let osPagedRows=[],osPageCursor=null,osTotal=0;
function osCard(order){
  return '<button type="button" class="os-card" data-os="'+order.id+'" aria-label="Abrir OS '+order.os_number+'"><strong>OS #'+order.os_number+' · '+esc(order.customer_name)+'</strong><p>'+esc(order.machine_brand||'')+' '+esc(order.machine_model||'')+'<br>'+esc(order.problem_reported)+'</p>'+badge(order.status)+'</button>';
}
function filterLoadedKanban(){
  const input=$('#osBoardSearch');
  if(!input)return;
  const query=String(input.value||'').trim().toLocaleLowerCase('pt-BR');
  let visible=0;
  $('.kanban .os-card').forEach(card=>{
    const matches=!query||card.textContent.toLocaleLowerCase('pt-BR').includes(query);
    card.hidden=!matches;
    if(matches)visible++;
  });
  const count=$('#osBoardSearchCount');
  if(count)count.textContent=query
    ?visible+' resultado(s) entre '+osPagedRows.length+' OS carregadas'
    :osPagedRows.length+' OS carregadas';
}
function bindOrderCards(host=document){
  const canMove=['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role);
  host.querySelectorAll('[data-os]').forEach(card=>{
    card.onclick=()=>openWorkOrder(card.dataset.os);
    if(!card.closest('.kanban'))return;
    card.title=canMove?'Arraste para outra etapa ou abra a OS para consultar as ações':'Abrir detalhes da OS';
    if(!canMove)return;
    card.draggable=true;
    card.ondragstart=event=>{
      if(!event.dataTransfer)return;
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',card.dataset.os);
      card.classList.add('os-dragging');
    };
    card.ondragend=()=>{
      card.classList.remove('os-dragging');
      $('.os-drop-target').forEach(column=>column.classList.remove('os-drop-target'));
    };
  });
  if(!canMove)return;
  host.querySelectorAll('[data-os-status]').forEach(column=>{
    column.ondragover=event=>{
      if(!event.dataTransfer?.types.includes('text/plain'))return;
      event.preventDefault();
      event.dataTransfer.dropEffect='move';
      column.classList.add('os-drop-target');
    };
    column.ondragleave=event=>{
      if(!column.contains(event.relatedTarget))column.classList.remove('os-drop-target');
    };
    column.ondrop=async event=>{
      event.preventDefault();
      column.classList.remove('os-drop-target');
      const id=Number(event.dataTransfer?.getData('text/plain'));
      const target=column.dataset.osStatus;
      if(!Number.isSafeInteger(id)||id<=0||!target)return;
      const row=osPagedRows.find(item=>Number(item.id)===id);
      if(!row||row.status===target)return;
      try{
        // O estado exibido não é uma fonte de verdade. Consultar a versão e as
        // transições mais recentes antes de qualquer alteração de domínio.
        const os=await api(`/api/work-orders/${id}`);
        const throughQuote=['ORCAMENTO','AGUARDANDO_APROVACAO','APROVADA','REPROVADA'];
        if(!os.availableTransitions?.includes(target)||throughQuote.includes(target)){
          toast('Esta etapa exige uma ação específica da OS. Consulte as opções disponíveis.',true);
          await openWorkOrder(id);
          return;
        }
        if(!confirm(`Mover OS #${os.os_number} de ${os.status.replaceAll('_',' ')} para ${target.replaceAll('_',' ')}?`))return;
        // Reutiliza POST /status, expectedVersion, requestId, checagens de
        // permissão, justificativas, conflito 409 e atualização confirmada.
        const button=document.createElement('button');
        button.dataset.status=target;
        await changeWorkOrderStatus(button,id,os);
      }catch(error){
        toast('Não foi possível mover a OS: '+error.message,true);
      }
    };
  });
}
function osColumnContent(status,label,total,items){
 const cards=items.length?items.map(osCard).join(''):total>0?'<div class="empty">Há OS nesta etapa. Carregue as ordens para visualizar.</div>':'<div class="empty">Nenhuma OS nesta etapa.</div>';
 const more=total>items.length?'<button type="button" class="btn sm soft" data-os-more="'+status+'">Carregar mais ('+(total-items.length)+')</button>':'';
 return '<div class="kanban-title"><span>'+label+'</span><b>'+total+'</b></div>'+cards+more;
}
async function renderWorkOrders({append=false}={}){
  pageTitle('Ordens de Serviço','OFICINA');
  const path='/api/work-orders/page?scope=active&limit=100'+(append&&osPageCursor?'&cursor='+encodeURIComponent(osPageCursor):'');
  const [page,summary]=await Promise.all([api(path),api('/api/dashboard')]);
  osPagedRows=append?osPagedRows.concat(page.items.filter(item=>!osPagedRows.some(row=>row.id===item.id))):page.items;
  osPageCursor=page.nextCursor;osTotal=page.total;
  const orders=osPagedRows;
  const canCreate=['ADMIN','ATENDIMENTO'].includes(state.user.role);
  const OS_COLUMNS=orderColumns(summary.flow);
  const columns=OS_COLUMNS.map(([status,label])=>{
    const items=orders.filter(order=>order.status===status);
    const total=summary.counts[status]||0;
    return '<div class="kanban-col" data-os-status="'+status+'">'+osColumnContent(status,label,total,items)+'</div>';
  }).join('');
  setContent('<div class="section-head"><div><h2>Fluxo da oficina</h2><span class="muted" id="osLoadedCount">'+orders.length+' de '+osTotal+' OS em fluxo carregadas</span></div>'+
    (canCreate?'<button id="newOS" class="btn primary">+ Abrir OS</button>':'')+'</div>'+
    (canCreate||state.user.role==='TECNICO'?'<p class="kanban-help">Arraste a OS para uma etapa permitida ou abra o cartão para realizar ações como orçamento e aprovação. No celular, abra o cartão para mudar a etapa.</p>':'')+
    '<div class="os-board-toolbar"><label for="osBoardSearch">Buscar nas OS carregadas</label>'+
    '<input id="osBoardSearch" type="search" autocomplete="off" placeholder="Nº da OS, cliente, equipamento ou problema">'+
    '<small id="osBoardSearchCount" class="muted" aria-live="polite"></small></div>'+
    '<div class="kanban">'+columns+'</div>'+
    '<section class="card" style="margin-top:18px"><div class="section-head"><div><h2>Histórico de OS encerradas</h2><span class="muted">Entregues, canceladas, reprovadas e transferidas · consulta paginada ao banco</span></div></div>'+
    '<div class="action-row" style="margin-bottom:14px;flex-wrap:wrap">'+
    '<label>Status <select id="osArchiveStatus"><option value="">Todos os encerramentos</option>'+
      OS_CLOSED_STATUSES.map(status=>'<option value="'+status+'">'+status.replaceAll('_',' ')+'</option>').join('')+'</select></label>'+
    '<label>Pesquisar OS <input id="osArchiveSearch" type="search" placeholder="Nº, cliente, modelo ou problema"></label>'+
    '<button id="osArchiveFilter" class="btn sm" type="button">Buscar</button></div>'+
    '<div id="osArchiveCount" class="muted" aria-live="polite"></div>'+
    '<div id="osArchiveRows" class="list"><div class="empty">Carregando histórico…</div></div>'+
    '<button id="osArchiveMore" class="btn sm soft" type="button" hidden>Carregar mais</button></section>');
  const newOS=$('#newOS');if(newOS)newOS.onclick=openNewWorkOrder;
  bindOrderCards($('#content'));
  $('#osBoardSearch').oninput=filterLoadedKanban;
  filterLoadedKanban();
  const bindColumnMore=()=>{
    $$('[data-os-more]').forEach(button=>button.onclick=async()=>{
      const status=button.dataset.osMore;
      const column=button.closest('[data-os-status]');
      const loaded=osPagedRows.filter(order=>order.status===status).sort((a,b)=>b.id-a.id);
      const cursor=loaded.length?'&cursor='+encodeURIComponent(loaded[loaded.length-1].id):'';
      button.disabled=true;
      button.textContent='Carregando OS…';
      column?.setAttribute('aria-busy','true');
      try{
        const page=await api('/api/work-orders/page?scope=active&status='+encodeURIComponent(status)+'&limit=50'+cursor);
        if(!column?.isConnected)return;
        const known=new Set(osPagedRows.map(item=>item.id));
        osPagedRows.push(...page.items.filter(item=>!known.has(item.id)));
        const all=osPagedRows.filter(item=>item.status===status).sort((a,b)=>b.id-a.id);
        const label=OS_COLUMNS.find(item=>item[0]===status)[1];
        renderRegion(column,osColumnContent(status,label,page.total,all));
        bindOrderCards(column);
        filterLoadedKanban();
        const loadedCount=$('#osLoadedCount');
        if(loadedCount)loadedCount.textContent=osPagedRows.length+' de '+osTotal+' OS em fluxo carregadas';
        bindColumnMore();
      }catch(error){
        if(column?.isConnected&&error?.name!=='AbortError'){
          button.textContent='Tentar novamente';
          toast('Não foi possível carregar as OS desta etapa. Tente novamente.',true);
        }
      }
      finally{button.disabled=false;column?.removeAttribute('aria-busy')}
    });
  };
  bindColumnMore();
  let archive=[],archiveCursor=null,sequence=0;
  const loadArchive=async({more=false}={})=>{
    const request=++sequence,status=$('#osArchiveStatus')?.value||'';
    const search=$('#osArchiveSearch')?.value.trim()||'';
    const query=new URLSearchParams({scope:'closed',limit:'50'});
    if(more&&archiveCursor)query.set('cursor',String(archiveCursor));
    if(status)query.set('status',status);
    if(search)query.set('search',search);
    const page=await api('/api/work-orders/page?'+query.toString());
    const host=$('#osArchiveRows');
    if(request!==sequence||!host||!host.isConnected)return;
    archive=more?archive.concat(page.items):page.items;
    archiveCursor=page.nextCursor;
    const markup=archive.length?archive.map(order=>'<div class="list-item" style="align-items:center">'+osCard(order)+
      '<small>'+(order.delivered_at?'Entrega: '+dt(order.delivered_at):'Encerrada · '+dt(order.updated_at))+'</small></div>').join(''):
      '<div class="empty">Nenhuma OS encerrada encontrada.</div>';
    const template=document.createElement('template');template.innerHTML=markup;
    reconcileChildren(host,template.content);
    bindOrderCards(host);
    $('#osArchiveCount').textContent=archive.length+' de '+page.total+' OS encerrada(s) carregadas';
    $('#osArchiveMore').hidden=!archiveCursor;
  };
  $('#osArchiveStatus').onchange=()=>loadArchive().catch(error=>toast(error.message,true));
  $('#osArchiveSearch').onchange=()=>loadArchive().catch(error=>toast(error.message,true));
  $('#osArchiveSearch').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();loadArchive().catch(error=>toast(error.message,true))}};
  $('#osArchiveFilter').onclick=()=>loadArchive().catch(error=>toast(error.message,true));
  $('#osArchiveMore').onclick=()=>loadArchive({more:true}).catch(error=>toast(error.message,true));
  await loadArchive();
}

function workOrderModal(customers,machines,techs){
  const requestId=newCommandId();
  showModal('Abrir ordem de serviço',workOrderEntryForm(customers,techs),async fd=>{
    const o=formObj(fd);
    if(o.customerId==='new'){
      const customer=await api('/api/customers',{method:'POST',body:{name:o.newCustomerName,phone:o.newCustomerPhone,requestId:requestId+':customer'}});
      const option=new Option(customer.name,String(customer.id),true,true);$('#osCustomer').add(option);$('#osCustomer').value=String(customer.id);
      $('#osNewCustomer').hidden=true;$('#osNewCustomer').disabled=true;o.customerId=customer.id;
      toast('Cliente cadastrado. Continuando a abertura da OS.');
    }
    if(o.machineId==='new'){
      const machine=await api('/api/machines',{method:'POST',body:{customerId:Number(o.customerId),type:o.newMachineType,brand:o.newMachineBrand,model:o.newMachineModel,plate:o.newMachinePlate,requestId:requestId+':machine'}});
      const option=new Option(machineLabel(machine),String(machine.id),true,true);$('#osMachine').add(option);$('#osMachine').value=String(machine.id);
      $('#osNewMachine').hidden=true;$('#osNewMachine').disabled=true;o.machineId=machine.id;
      toast('Equipamento cadastrado. Continuando a abertura da OS.');
    }
    const created=await api('/api/work-orders',{method:'POST',body:{requestId,customerId:Number(o.customerId),machineId:Number(o.machineId),
      problemReported:o.problemReported,priority:o.priority,...(o.technicianId?{technicianId:Number(o.technicianId)}:{}),
      ...(o.estimatedDelivery?{estimatedDelivery:new Date(o.estimatedDelivery).toISOString()}: {})}});
    if(modalSession)modalSession.dirty=false;
    toast(`OS #${created.os_number} aberta`);await refreshCurrentPage();await openWorkOrder(created.id);
  });
  const customer=$('#osCustomer'),machine=$('#osMachine');
  const toggle=(id,show)=>{const fieldset=$(id);fieldset.hidden=!show;fieldset.disabled=!show;};
  const machinePicker=bindPagedSelector({select:machine,search:$('#osMachineSearch'),more:$('#osMachineMore'),notice:$('#osMachineNotice'),
    path:'/api/machines/page',label:machineLabel,allowNew:true,onChange:value=>toggle('#osNewMachine',value==='new')});
  const chooseCustomer=async value=>{
    machinePicker.cancel();
    toggle('#osNewCustomer',value==='new');toggle('#osNewMachine',value==='new');
    $('#osMachineSearch').disabled=!value||value==='new';$('#osMachineSearch').value='';machine.value='';
    if(value==='new'){renderRegion(machine,'<option value="new">Novo equipamento deste cliente</option>');machine.value='new';}
    else if(value){renderRegion(machine,'<option value="">Selecione</option><option value="new">+ Cadastrar agora</option>');await machinePicker.update({customerId:value});}
    else renderRegion(machine,'<option value="">Selecione o cliente</option>');
  };
  const customerPicker=bindPagedSelector({select:customer,search:$('#osCustomerSearch'),more:$('#osCustomerMore'),notice:$('#osCustomerNotice'),
    path:'/api/customers/page',label:c=>c.name,allowNew:true,onChange:value=>void chooseCustomer(value)});
  void customerPicker.load();
}

function osPrimaryAction(status,hasQuote,pendingCents=0,role=''){
  if(status==='PRONTA'&&Number(pendingCents)>0&&['ADMIN','FINANCEIRO'].includes(role))
    return {label:'Receber antes da entrega',target:'#receivePaymentBtn',hint:'Existe um valor pendente. Registre o recebimento ou prepare uma cobrança; a entrega permanece disponível na OS.'};
  const steps={
    ENTRADA:{label:'Começar diagnóstico',target:'[data-status="DIAGNOSTICO"]',hint:'Registre o diagnóstico e os próximos serviços necessários.'},
    DIAGNOSTICO:{label:'Montar orçamento',target:'#quoteBtn',hint:'Organize peças, mão de obra e valores antes de enviar.'},
    ORCAMENTO:hasQuote
      ?{label:'Solicitar aprovação',target:'#submitQuote',hint:'Compartilhe a proposta para a decisão do cliente.'}
      :{label:'Montar orçamento',target:'#quoteBtn',hint:'Inclua os serviços e confira os valores.'},
    AGUARDANDO_APROVACAO:{label:'Abrir link de aprovação',target:'#approvalLinkOS',hint:'Copie o link para enviar ao cliente pelo canal de atendimento.'},
    REPROVADA:{label:'Revisar orçamento',target:'#quoteBtn',hint:'Revise a proposta e solicite uma nova decisão.'},
    APROVADA:{label:'Iniciar serviço',target:'[data-status="EM_SERVICO"]',hint:'Inicie o trabalho autorizado.'},
    EM_SERVICO:{label:'Marcar serviço como pronto',target:'[data-status="PRONTA"]',hint:'Confira as peças utilizadas e o checklist antes de concluir.'},
    PRONTA:{label:'Registrar entrega',target:'[data-status="ENTREGUE"]',hint:'Confira recebimento e documentos antes da entrega.'}
  };
  return steps[status]||null;
}

async function openWorkOrder(id){const canFinance=['ADMIN','FINANCEIRO'].includes(state.user.role);let quoteLoadError=null;const safe=async p=>{try{return await api(p)}catch(error){if(error.status!==404)quoteLoadError=error;return null}};const [os,quote,parts,checklists,attachments,payment,templates,receipts]=await Promise.all([api(`/api/work-orders/${id}`),safe(`/api/work-orders/${id}/quote`),api(`/api/work-orders/${id}/parts`),api(`/api/work-orders/${id}/checklists`),api(`/api/work-orders/${id}/attachments`),canFinance?api(`/api/work-orders/${id}/payment`):Promise.resolve(null),api('/api/checklist-templates'),canFinance?api(`/api/work-orders/${id}/receipts`):Promise.resolve([])]);const next=(os.availableTransitions||[]).filter(status=>!['ORCAMENTO','APROVADA','REPROVADA','AGUARDANDO_APROVACAO'].includes(status));const uxNext=(['ADMIN','ATENDIMENTO'].includes(state.user.role)
 ||['ENTRADA','APROVADA','EM_SERVICO','PRONTA'].includes(os.status)&&state.user.role==='TECNICO'
 ||os.status==='PRONTA'&&Number(payment?.pendingCents||0)>0&&state.user.role==='FINANCEIRO')
 ?osPrimaryAction(os.status,Boolean(quote),payment?.pendingCents||0,state.user.role):null;
 showModal(`OS #${os.os_number} — ${os.customer_name}`,`
 <section class="os-next-action" aria-label="Próximo passo da ordem de serviço">
  <div><small>ETAPA ATUAL · ${esc(os.status.replaceAll('_',' '))}</small>
   <h3>${uxNext?'Próximo passo: '+esc(uxNext.label):'Acompanhamento da ordem de serviço'}</h3>
   <p>${uxNext?esc(uxNext.hint):'Consulte abaixo as ações, documentos e o histórico desta OS.'}</p></div>
  ${uxNext?'<button type="button" class="btn primary" id="nextOsAction">Continuar: '+esc(uxNext.label)+'</button>':''}
 </section>
 <div class="detail-grid"><div class="detail-block"><h3>Equipamento</h3><strong>${esc(os.machine_brand)} ${esc(os.machine_model)}</strong><p>${esc(os.problem_reported)}</p>${badge(os.status)}<p class="muted">Entrada: ${dt(os.entered_at)} · Técnico: ${esc(os.technician_name||'não definido')}</p></div><div class="detail-block"><h3>Ações de status</h3><div class="action-row">${(['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role)?next:[]).map(s=>`<button class="btn ${s==='CANCELADA'?'danger':'soft'}" data-status="${s}">${s==='CANCELADA'?'Cancelar OS':os.status==='PRONTA'&&s==='EM_SERVICO'?'Voltar para serviço':s.replaceAll('_',' ')}</button>`).join('')||'<span class="muted">Sem avanço direto disponível.</span>'}</div></div></div>
 <div class="detail-grid" style="margin-top:14px"><div class="detail-block"><h3>Diagnóstico</h3><form id="diagnosisForm" class="form-stack"><label>Diagnóstico técnico<textarea name="diagnosis" placeholder="Diagnóstico técnico" ${['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role)?'':'readonly'}>${esc(os.diagnosis)}</textarea></label>${['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role)?'<button class="btn sm" type="submit">Salvar diagnóstico</button>':''}</form></div><div class="detail-block"><h3>Documentos</h3><div class="action-row">${['work-order','quote','delivery','receipt'].map(k=>`<button class="btn sm" data-doc="${k}">${{ 'work-order':'OS',quote:'Orçamento',delivery:'Entrega',receipt:'Recibo'}[k]}</button><button class="btn sm soft" type="button" data-print="${k}" aria-label="Imprimir ${k}">Imprimir</button>`).join('')}</div></div></div>
 <div class="detail-grid" style="margin-top:14px"><div class="detail-block"><h3>Orçamento</h3>${quote?`<p><strong>${money(quote.total_cents)}</strong> · ${badge(quote.approval_status)}</p><div class="list">${quote.items.map(i=>`<div>${esc(i.description)} — ${i.quantity} × ${money(i.unit_price_cents)}</div>`).join('')}</div>`:quoteLoadError?'<p class="error" role="alert">Não foi possível carregar o orçamento. Ele não será tratado como inexistente.</p><button class="btn sm" id="retryQuote">Tentar novamente</button>':'<p class="muted">Ainda sem orçamento.</p>'}<div class="action-row" style="margin-top:10px">${!quoteLoadError&&['ADMIN','ATENDIMENTO'].includes(state.user.role)&&['DIAGNOSTICO','ORCAMENTO','REPROVADA'].includes(os.status)?'<button class="btn sm primary" id="quoteBtn">Criar/editar</button>':''}${['ADMIN','ATENDIMENTO'].includes(state.user.role)&&os.status==='ORCAMENTO'&&!quoteLoadError?'<button class="btn sm" id="submitQuote">Solicitar aprovação</button><button class="btn sm soft" id="approveQuote">Aprovar agora</button>':''}${['ADMIN','ATENDIMENTO'].includes(state.user.role)&&os.status==='AGUARDANDO_APROVACAO'&&!quoteLoadError?'<button class="btn sm soft" id="approveQuote">Aprovar</button><button class="btn sm danger" id="rejectQuote">Reprovar</button>':''}</div></div>
${canFinance?` <div class="detail-block os-finance"><h3>Recebimento</h3><p>Total: <strong>${money(payment.totalCents)}</strong><br>Recebido: <strong>${money(payment.receivedCents)}</strong><br>Pendente: <strong>${money(payment.pendingCents)}</strong> · ${badge(payment.status)}</p>${payment.pendingCents>0&&['ADMIN','FINANCEIRO'].includes(state.user.role)?'<p class="os-payment-hint">Escolha como receber. Valores informados manualmente exigem conferência do operador.</p><button type="button" class="btn primary os-receive-main" id="receivePaymentBtn">Receber pagamento</button>':''}${payment.pendingCents>0&&['ADMIN','FINANCEIRO'].includes(state.user.role)?'<div class="action-row"><button class="btn sm primary" id="payBtn">Registrar recebimento conferido</button><button class="btn sm" id="collectBtn">Gerar cobrança Pix / maquininha</button><button class="btn sm" id="billingPlanBtn">Parcelar ou cobrar depois</button></div>':''}<div class="list" style="margin-top:10px">${receipts.length?receipts.map(r=>`<div>${money(r.amount_cents)} · ${esc(r.method)} ${r.reversed_at?badge('ESTORNADO'):''}${!r.reversed_at&&['ADMIN','FINANCEIRO'].includes(state.user.role)?` <button type="button" class="btn danger sm" data-reverse-receipt="${r.id}">Estornar</button>`:''}</div>`).join(''):'<span class="muted">Sem recebimentos</span>'}</div></div>`:''}</div>
 <div class="detail-grid" style="margin-top:14px"><div class="detail-block"><h3>Peças utilizadas</h3>${parts.length?parts.map(p=>`<div>${esc(p.description)} × ${p.quantity} ${p.reversed_at?badge('ESTORNADO'):''}${!p.reversed_at&&['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role)?` <button type="button" class="btn danger sm" data-reverse-part="${p.id}">Estornar</button>`:''}</div>`).join(''):'<p class="muted">Nenhuma peça.</p>'}${['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role)&&['APROVADA','EM_SERVICO'].includes(os.status)?'<button class="btn sm" id="partBtn" style="margin-top:10px">+ Adicionar peça</button>':''}</div><div class="detail-block"><h3>Checklists e fotos</h3><p>${checklists.length} checklist(s) · ${attachments.length} anexo(s)</p><div class="action-row">${['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role)?'<button class="btn sm" id="checkBtn">+ Checklist</button><button class="btn sm" id="photoBtn">+ Foto/anexo</button>':''}</div></div></div>`);
 $$('[data-status]').forEach(button=>button.onclick=()=>changeWorkOrderStatus(button,id,os));if(['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role))$('#diagnosisForm').onsubmit=e=>saveWorkOrderDiagnosis(e,id,os);$$('[data-doc]').forEach(b=>b.onclick=()=>openDocument(id,b.dataset.doc));$$('[data-print]').forEach(b=>b.onclick=()=>printWorkOrderDocument(id,b.dataset.print));
 $$('[data-reverse-part]').forEach(b=>b.onclick=()=>reverseOsEntry(id,'part',b.dataset.reversePart));$$('[data-reverse-receipt]').forEach(b=>b.onclick=()=>reverseOsEntry(id,'receipt',b.dataset.reverseReceipt));
 const qb=$('#quoteBtn');if(qb)qb.onclick=()=>quoteModal(id,quote);const sq=$('#submitQuote');if(sq)sq.onclick=()=>startApprovalRequest(id,os.os_number);const aq=$('#approveQuote');if(aq)aq.onclick=()=>actionReload(`/api/work-orders/${id}/quote/approve`,{},id);const rq=$('#rejectQuote');if(rq)rq.onclick=()=>{const reason=prompt('Motivo da reprovação:');if(reason)actionReload(`/api/work-orders/${id}/quote/reject`,{reason},id)};const pb=$('#partBtn');if(pb)pb.onclick=()=>partModal(id);const cb=$('#checkBtn');if(cb)cb.onclick=()=>checklistModal(id,templates);const ph=$('#photoBtn');if(ph)ph.onclick=()=>attachmentModal(id);const receive=$('#receivePaymentBtn');if(receive)receive.onclick=()=>receivePaymentOptions(id,payment.pendingCents);const pay=$('#payBtn');if(pay)pay.onclick=()=>paymentModal(id,payment.pendingCents);const collect=$('#collectBtn');if(collect)collect.onclick=()=>collectionModal(id,payment.pendingCents);const bill=$('#billingPlanBtn');if(bill)bill.onclick=()=>billingPlanModal(id,payment.pendingCents);if($('#retryQuote'))$('#retryQuote').onclick=()=>openWorkOrder(id).catch(error=>toast(error.message,true));await enhanceWorkOrderModal(id,os);
 const nextAction=$('#nextOsAction');
 if(nextAction)nextAction.onclick=()=>{
   const target=$('#modalBody')?.querySelector(uxNext.target);
   if(target&&!target.disabled)target.click();
   else toast('Ação indisponível nesta etapa. Consulte as opções da OS.',true);
 };
}
function reverseOsEntry(workOrderId,type,itemId){
 const financial=type==='receipt';
 const endpoint=financial
   ?`/api/work-orders/${workOrderId}/receipts/${itemId}/reverse`
   :`/api/work-orders/${workOrderId}/parts/${itemId}/reverse`;
 const requestId=newCommandId();
 showModal(financial?'Confirmar estorno financeiro':'Confirmar devolução da peça',`<form class="form-stack">
   <p class="muted">${financial?'Esse estorno altera o saldo recebido da OS e registra o movimento financeiro.':'A peça será devolvida ao saldo de estoque da OS.'} O histórico será preservado.</p>
   <label>Motivo do estorno<textarea name="note" required minlength="3" maxlength="500" placeholder="Descreva o motivo para auditoria"></textarea></label>
   <div class="action-row">
    <button type="button" class="btn" id="keepOsEntry">Manter lançamento</button>
    <button type="submit" class="btn danger">Confirmar estorno</button>
   </div></form>`,async fd=>{
    const note=String(fd.get('note')||'').trim();
    if(note.length<3)throw new Error('Informe um motivo com pelo menos 3 caracteres.');
    await api(endpoint,{method:'POST',body:{note,requestId}});
    toast(financial?'Recebimento estornado':'Peça devolvida ao estoque');
    await openWorkOrder(workOrderId);
 });
 $('#keepOsEntry').onclick=()=>closeModal();
}
const actionCommandIds=new Map();
async function actionReload(path,body,id){
  if(modalSession?.busy)return;
  if(modalSession?.dirty){toast('Salve as alterações antes de continuar.',true);return;}
  const token=state.modalToken;
  if(modalSession)modalSession.busy=true;
  const buttons=$$('button',$('#modalBody')).map(button=>[button,button.disabled]);
  for(const [button] of buttons)button.disabled=true;
  const key=`${id}:${path}:${JSON.stringify(body)}`;
  const requestId=actionCommandIds.get(key)||newCommandId();
  actionCommandIds.set(key,requestId);
  try{
    await api(path,{method:'POST',body:{...body,requestId}});
    actionCommandIds.delete(key);
    if(state.modalToken===token&&modalSession)modalSession.busy=false;
    toast('Operação confirmada. OS atualizada.');await openWorkOrder(id);
  }catch(error){toast(error.message,true);}
  finally{
    for(const [button,disabled] of buttons)if(button.isConnected)button.disabled=disabled;
    if(state.modalToken===token&&modalSession)modalSession.busy=false;
  }
}

function addQuoteItemRow(item={}){const host=$('#quoteItems');if(!host)return;const row=document.createElement('div');row.className='quote-item-row';row.innerHTML=`<label>Tipo<select data-q-kind><option value="MAO_DE_OBRA" ${item.kind==='MAO_DE_OBRA'?'selected':''}>Mão de obra</option><option value="PECA" ${item.kind==='PECA'?'selected':''}>Peça</option><option value="TERCEIRO" ${item.kind==='TERCEIRO'?'selected':''}>Terceiro</option></select></label><label>Descrição<input data-q-description required value="${esc(item.description||'')}"></label><label>Qtd.<input data-q-quantity type="number" min="0.01" step="0.01" value="${item.quantity||1}"></label><label>Valor unitário (R$)<input data-q-price type="number" min="0" step="0.01" value="${item.unit_price_cents!=null?item.unit_price_cents/100:''}"></label><button type="button" class="btn danger sm" data-remove-quote-item>Remover</button>`;host.appendChild(row);$('[data-remove-quote-item]',row).onclick=()=>{if($$('.quote-item-row',host).length>1)row.remove();else toast('O orçamento precisa ter ao menos um item.',true)}}
function quoteModal(id,q){const requestId=newCommandId();showModal('Orçamento da OS',`<form class="form-stack"><div class="card-head"><strong>Itens do orçamento</strong><button id="addQuoteItem" type="button" class="btn sm soft">+ Adicionar item</button></div><div id="quoteItems" class="quote-items"></div><div class="field-row"><label>Desconto (R$)<input name="discount" type="number" min="0" step="0.01" value="${q?(q.discount_cents/100):0}"></label><label>Validade<input name="validUntil" type="date" value="${esc(q?.valid_until||'')}"></label></div><label>Observações<textarea name="notes">${esc(q?.notes||'')}</textarea></label><button class="btn primary" type="submit">Salvar orçamento</button></form>`,async fd=>{const host=$('#quoteItems');const items=$$('.quote-item-row',host).map(row=>({kind:$('[data-q-kind]',row).value,description:$('[data-q-description]',row).value.trim(),quantity:Number($('[data-q-quantity]',row).value),unitPriceCents:Math.round(Number($('[data-q-price]',row).value)*100)}));if(items.some(i=>!i.description||!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isInteger(i.unitPriceCents)||i.unitPriceCents<0))throw new Error('Revise os itens do orçamento.');const o=formObj(fd);await api(`/api/work-orders/${id}/quote`,{method:'PUT',body:{requestId,discountCents:Math.round(Number(o.discount||0)*100),validUntil:o.validUntil||null,notes:o.notes,items}});toast('Orçamento salvo');await openWorkOrder(id)});(q?.items?.length?q.items:[{}]).forEach(addQuoteItemRow);$('#addQuoteItem').onclick=()=>addQuoteItemRow()}
function partModal(id){const requestId=newCommandId();showModal('Adicionar peça à OS',`<form class="form-stack"><label>Peça<select id="workOrderPart" name="partId" required><option value="">Selecione uma peça</option></select></label><label>Quantidade<input name="quantity" type="number" min="0.01" step="0.01" value="1" required></label><button class="btn primary" type="submit">Baixar no estoque e adicionar</button></form>`,async fd=>{const o=formObj(fd);await api(`/api/work-orders/${id}/parts`,{method:'POST',body:{requestId,partId:Number(o.partId),quantity:Number(o.quantity)}});toast('Peça adicionada');await openWorkOrder(id)});attachPagedLookup($('#workOrderPart'),{resource:'parts',label:'peças',placeholder:'Buscar SKU ou descrição'});}

let checklistRequestVersion=0;
async function renderChecklistItems(templateId){
  const host=$('#checklistItems');
  if(!host||!templateId)return;
  const version=++checklistRequestVersion;
  renderRegion(host,'<div class="empty">Carregando itens…</div>');
  const template=await api(`/api/checklist-templates/${templateId}`);
  if(version!==checklistRequestVersion||!$('#modalBody')?.contains(host)||
     String($('#checkTemplate')?.value)!==String(templateId))return null;
  renderRegion(host,template.items.map(i=>
    `<div class="check-item" data-check-position="${i.position}">
       <div><strong>${esc(i.label)}</strong>${i.required?'<small>Obrigatório</small>':''}</div>
       <select data-check-response><option value="OK">OK</option>
         <option value="ATENCAO">Atenção</option>
         <option value="NAO_SE_APLICA">Não se aplica</option></select>
       <input data-check-note placeholder="Observação opcional">
     </div>`).join('')||'<div class="empty">Este modelo não possui itens.</div>');
  return template;
}
function checklistModal(id,templates){if(!templates.length){toast('Nenhum modelo de checklist disponível.',true);return}const requestId=newCommandId();showModal('Registrar checklist',`<form class="form-stack"><label>Modelo<select id="checkTemplate" name="templateId">${templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><div id="checklistItems" class="checklist-items"></div><button class="btn primary" type="submit">Concluir checklist</button></form>`,async fd=>{const host=$('#checklistItems');const responses=$$('[data-check-position]',host).map(row=>({position:Number(row.dataset.checkPosition),response:$('[data-check-response]',row).value,note:$('[data-check-note]',row).value.trim()}));if(!responses.length)throw new Error('O checklist não possui itens.');await api(`/api/work-orders/${id}/checklists`,{method:'POST',body:{requestId,templateId:Number(fd.get('templateId')),responses}});toast('Checklist registrado');await openWorkOrder(id)});const select=$('#checkTemplate');select.onchange=()=>renderChecklistItems(select.value).catch(err=>toast(err.message,true));renderChecklistItems(select.value).catch(err=>toast(err.message,true))}
function attachmentModal(id){const requestId=newCommandId();showModal('Adicionar foto/anexo',`<form class="form-stack"><label>Categoria<select name="category"><option>ENTRADA</option><option>DIAGNOSTICO</option><option>SERVICO</option><option>ENTREGA</option><option>OUTRO</option></select></label><label>Legenda<input name="caption"></label><label>Arquivo<input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><button class="btn primary" type="submit">Enviar para armazenamento local</button></form>`,async fd=>{const file=fd.get('file');const base64=await fileToBase64(file);await api(`/api/work-orders/${id}/attachments`,{method:'POST',body:{requestId,category:fd.get('category'),caption:fd.get('caption'),originalName:file.name,mimeType:file.type,base64}});toast('Anexo salvo');await openWorkOrder(id)})}
function fileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file)})}
function receivePaymentOptions(id,pending){
  showModal('Receber pagamento',`<div class="form-stack receipt-options">
    <p><strong>Saldo a receber: ${money(pending)}</strong></p>
    <p class="muted">Escolha uma forma de recebimento. Todas as opções também ficam disponíveis na seção Recebimento da OS.</p>
    <button type="button" class="btn primary" id="chooseManualReceipt">Já recebi — registrar pagamento conferido</button>
    <button type="button" class="btn soft" id="choosePaymentCollection">Gerar cobrança Pix / maquininha</button>
    <button type="button" class="btn soft" id="choosePaymentPlan">Parcelar ou cobrar depois</button>
    <small>Gerar uma cobrança não significa que o dinheiro entrou. Pagamentos manuais exigem conferência.</small>
  </div>`);
  $('#chooseManualReceipt').onclick=()=>paymentModal(id,pending);
  $('#choosePaymentCollection').onclick=()=>collectionModal(id,pending);
  $('#choosePaymentPlan').onclick=()=>billingPlanModal(id,pending);
}
function paymentModal(id,pending){const requestId=globalThis.crypto?.randomUUID?.()||`os-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`;showModal('Registrar pagamento conferido',`<form class="form-stack"><p class="muted">Registre somente valores já recebidos. Pix, cartão e transferência devem ser conferidos no banco ou na maquininha.</p><label>Valor (R$)<input name="amount" type="number" step="0.01" max="${pending/100}" value="${pending/100}" required></label><label>Forma<select name="method"><option>PIX</option><option>DINHEIRO</option><option>CARTAO</option><option>TRANSFERENCIA</option><option>BOLETO</option></select></label><label>Observação<input name="note"></label><label class="sales-payment-verification sale-verify-label"><input type="checkbox" name="verifiedManualReceipt" id="verifiedManualReceipt" required> Confirmo que o pagamento foi efetivamente recebido e conferido</label><button class="btn primary" type="submit">Confirmar recebimento</button></form>`,async fd=>{if(fd.get("verifiedManualReceipt")!=="on")throw new Error("Pagamento não conferido. Confirme o recebimento antes de registrar.");const o=formObj(fd);await api(`/api/work-orders/${id}/receipts`,{method:'POST',body:{requestId,amountCents:Math.round(Number(o.amount)*100),method:o.method,note:o.note}});toast('Pagamento registrado');await openWorkOrder(id)})}
async function openDocument(id,kind){try{const doc=await api(`/api/work-orders/${id}/documents/${kind}`,{raw:true});const url=URL.createObjectURL(new Blob([doc],{type:'text/html'}));window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){toast(e.message,true)}}



 
// A cobrança não dá baixa enquanto estiver pendente. A fonte da verdade é o
// comprovante registrado manualmente ou a consulta autenticada ao provedor.
async function collectionModal(workOrderId,pendingCents){
 const abilities=await api('/api/payment-intents/capabilities');
 const methods=[
  abilities.pixStatic&&['PIX_STATIC','Pix Copia e Cola (conferência manual)'],
  abilities.pixApi&&['PIX_API','Pix automático (banco)'],
  abilities.tef&&['TEF','Cartão via TEF'],
  abilities.smartPos&&['SMART_POS','Maquininha integrada']
 ].filter(Boolean);
 if(!methods.length){
  toast('Nenhum provedor configurado. Use o registro manual ou configure o Pix da oficina.',true);
  return;
 }
 const requestId=newCommandId();
 showModal('Nova cobrança da OS',`<form class="form-stack">
  <p class="muted">Criar cobrança não significa pagamento recebido. O saldo só será baixado após confirmação.</p>
  <label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01"
   max="${pendingCents/100}" value="${pendingCents/100}" required></label>
  <label>Meio de cobrança<select name="method">
   ${methods.map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}
  </select></label>
  <button class="btn primary" type="submit">Gerar cobrança</button>
 </form>`,async fd=>{
  const amountCents=Math.round(Number(fd.get('amount'))*100);
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>pendingCents)
   throw new Error('Informe um valor válido até o saldo pendente');
  const intent=await api('/api/payment-intents',{method:'POST',body:{
   workOrderId,amountCents,method:fd.get('method'),requestId
  }});
  showCollectionIntent(intent,workOrderId);
 });
}
function showCollectionIntent(intent,workOrderId){
 const staticPix=intent.method==='PIX_STATIC';
 const payload=intent.pix_payload||'';
 const name=staticPix?'Pix Copia e Cola':'Cobrança enviada ao provedor';
 showModal(name,`<div class="form-stack">
  <strong>${money(intent.amount_cents)}</strong>
  <p class="muted">Situação: ${esc(intent.status)} — OS vinculada #${workOrderId}</p>
  ${payload?`<label>Código Pix<input id="collectionPixPayload" readonly value="${esc(payload)}"></label><button type="button" class="btn sm" id="copyCollectionPix">Copiar Pix</button>`:''}
  <p class="muted">${staticPix?
    'Pix estático: confira o valor na sua conta bancária antes de usar Registrar pagamento manual. Esta cobrança não tem confirmação automática.':
    'Após pagar no terminal ou no banco, consulte a situação. A confirmação é conferida diretamente com o provedor.'}</p>
  ${staticPix?'':`<button type="button" class="btn primary" id="syncCollection">Consultar confirmação</button>`}
  <button type="button" class="btn sm" id="backCollectionOrder">Voltar à OS</button>
 </div>`);
 const copy=$('#copyCollectionPix');
 if(copy)copy.onclick=async()=>{
  const field=$('#collectionPixPayload');
  field.select();
  try{await navigator.clipboard.writeText(field.value);toast('Pix copiado')}
  catch{toast('Selecione e copie o código Pix')}
 };
 const sync=$('#syncCollection');
 if(sync)sync.onclick=async()=>{
  sync.disabled=true;
  try{
   const latest=await api('/api/payment-intents/'+intent.id+'/sync',{method:'POST',body:{}});
   if(latest.status==='PAID'){
    toast('Pagamento confirmado pelo provedor');await openWorkOrder(workOrderId);
   }else{toast('Ainda sem confirmação de pagamento');showCollectionIntent(latest,workOrderId)}
  }catch(error){toast(error.message,true);sync.disabled=false;}
 };
 const back=$('#backCollectionOrder');
 if(back)back.onclick=()=>openWorkOrder(workOrderId).catch(error=>toast(error.message,true));
}

 
async function billingPlanModal(workOrderId,pendingCents){
 const existing=await api('/api/billing/orders/'+workOrderId+'/plan');
 if(existing)return displayBillingPlan(existing,workOrderId);
 const caps=await api('/api/billing/capabilities');
 const options=[['MANUAL','Parcelamento no financeiro (sem provedor)'],
  ...(caps.boleto?[['BOLETO','Boleto (integração opcional)']]:[]),
  ...(caps.paymentLink?[['PAYMENT_LINK','Link de pagamento (integração opcional)']]:[])
 ];
 const requestId=newCommandId();
 const today=new Date().toISOString().slice(0,10);
 showModal('Parcelar cobrança — OS',`<form class="form-stack">
   <p class="muted">O parcelamento registra vencimentos, sem simular recebimento. Boleto e link requerem um provedor habilitado para esta oficina.</p>
   <label>Saldo a parcelar (R$)<input value="${(pendingCents/100).toFixed(2)}" readonly></label>
   <label>Número de parcelas<input name="count" type="number" min="1" max="24" value="2" required></label>
   <label>Primeiro vencimento<input name="firstDueDate" type="date" value="${today}" required></label>
   <label>Modalidade<select name="method">${options.map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}</select></label>
   <button class="btn primary" type="submit">Gerar plano de cobrança</button>
 </form>`,async fd=>{
   const plan=await api('/api/billing/plans',{method:'POST',body:{
     workOrderId,amountCents:pendingCents,count:Number(fd.get('count')),
     firstDueDate:fd.get('firstDueDate'),method:fd.get('method'),requestId
   }});
   displayBillingPlan(plan,workOrderId);
 });
}
async function displayBillingPlan(plan,workOrderId){
  const caps=await api('/api/billing/capabilities');
 const methods={BOLETO:'Boleto',PAYMENT_LINK:'Link',MANUAL:'Manual'};
 showModal('Parcelamento — OS #'+workOrderId,`<div class="form-stack">
  <p><strong>${money(plan.amount_cents)}</strong> · ${plan.installment_count} parcela(s) · ${esc(methods[plan.method]||plan.method)}</p>
  <div class="list">${plan.installments.map(i=>`<div class="list-item">
   <div><strong>${i.installment_number}ª parcela — ${money(i.amount_cents)}</strong><br>
   <small>Vence em ${esc(i.due_date)} · ${esc(i.status)}</small></div>
   <div class="action-row">
    ${i.payment_url?`<a href="${esc(i.payment_url)}" rel="noopener noreferrer" target="_blank">Abrir cobrança</a>`:''}
    ${i.status==='PENDING'&&plan.method==='MANUAL'?`<button class="btn sm" data-manual-billing="${i.id}">Confirmar recebido</button>`:''}
    ${i.status==='PENDING'&&plan.method!=='MANUAL'?`<button class="btn sm" data-provider-billing="${i.id}" data-command="${i.provider_ref?'sync':'activate'}">${i.provider_ref?'Consultar':'Emitir cobrança'}</button>`:''}
    ${i.status==='PAID'&&!i.refund_id?`<button class="btn sm" data-settle-billing="${i.id}">Taxa/repasse</button>`:''}
     ${i.status==='PAID'&&plan.method!=='MANUAL'&&caps.externalRefunds?`<button class="btn sm" data-refund-billing="${i.id}" data-refund-id="${i.refund_id||''}">${i.refund_id?'Consultar estorno':'Solicitar estorno'}</button>`:''}
     ${i.refund_status?`<small>Estorno: ${esc(i.refund_status)}</small>`:''}
   </div></div>`).join('')}</div>
  <button class="btn sm" id="billingBackOrder">Voltar à OS</button>
 </div>`);
 $$('[data-manual-billing]').forEach(btn=>btn.onclick=async()=>{
  if(!confirm('Você conferiu o recebimento real? Esta ação dará baixa no caixa/financeiro.'))return;
  try{
   await api('/api/billing/installments/'+btn.dataset.manualBilling+'/manual',{method:'POST',body:{verified:true}});
   const next=await api('/api/billing/plans/'+plan.id);
   displayBillingPlan(next,workOrderId);toast('Recebimento lançado');
  }catch(error){toast(error.message,true)}
 });
 $$('[data-provider-billing]').forEach(btn=>btn.onclick=async()=>{
  btn.disabled=true;
  try{
   const row=await api('/api/billing/installments/'+btn.dataset.providerBilling+'/'+btn.dataset.command,{method:'POST',body:{}});
   const next=await api('/api/billing/plans/'+plan.id);
   displayBillingPlan(next,workOrderId);
   toast(row.status==='PAID'?'Cobrança recebida e conciliada':'Cobrança ainda pendente');
  }catch(error){toast(error.message,true);btn.disabled=false}
 });
  $$('[data-refund-billing]').forEach(btn=>btn.onclick=async()=>{
   try{
    if(btn.dataset.refundId){
     const refund=await api('/api/billing/refunds/'+btn.dataset.refundId+'/sync',
      {method:'POST',body:{}});
     toast(refund.status==='APPLIED'?'Estorno confirmado e lançado no financeiro':
      'Estorno externo: '+refund.status);
    }else{
     if(!confirm('Solicitar devolução REAL ao provedor? Confirme que não há extrato ou repasse conciliado.'))return;
     const refund=await api('/api/billing/installments/'+btn.dataset.refundBilling+'/refund',
      {method:'POST',body:{requestId:newCommandId()}});
     toast('Estorno solicitado: '+refund.status+'. Consulte para confirmar.');
    }
    const next=await api('/api/billing/plans/'+plan.id);
    await displayBillingPlan(next,workOrderId);
   }catch(error){toast(error.message,true)}
  });
  $$('[data-settle-billing]').forEach(btn=>btn.onclick=async()=>{
  const cents=prompt('Taxa da operadora (R$):','0.00');
  if(cents===null)return;
  if(!/^\d+(?:[.,]\d{1,2})?$/.test(cents.trim())){toast('Taxa inválida',true);return}
  try{
   const feeCents=Math.round(Number(cents.replace(',','.'))*100);
   await api('/api/billing/settlements',{method:'POST',body:{
    installmentId:btn.dataset.settleBilling,feeCents,
    settledAt:new Date().toISOString().slice(0,10),requestId:newCommandId()
   }});
   toast('Taxa e repasse conciliados');
  }catch(error){toast(error.message,true)}
 });
 const back=$('#billingBackOrder');
 if(back)back.onclick=()=>openWorkOrder(workOrderId).catch(error=>toast(error.message,true));
}

// A janela é aberta sincronamente pela ação do operador para evitar popup bloqueado.
// Nunca imprime automaticamente; exige clique explícito em "Imprimir".
async function printWorkOrderDocument(id,kind){
  const printWindow=window.open('about:blank','_blank');
  if(!printWindow){toast('Permita a abertura de janelas para imprimir.',true);return;}
  printWindow.document.body.textContent='Preparando documento para impressão...';
  try{
    const doc=await api(`/api/work-orders/${id}/documents/${kind}`,{raw:true});
    if(printWindow.closed)return;
    printWindow.addEventListener('load',()=>{
      if(!printWindow.closed){printWindow.focus();printWindow.print();}
    },{once:true});
    printWindow.document.open();
    printWindow.document.write(doc);
    printWindow.document.close();
  }catch(error){
    printWindow.close();
    toast('Falha ao preparar impressão: '+error.message,true);
  }
}
