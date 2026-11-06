async function renderInventory({cursor=null,loaded=[]}={}){
 pageTitle('Peças e Estoque','OPERAÇÃO');
 const office=['ADMIN','ATENDIMENTO'].includes(state.user.role);
 const [page,orders]=await Promise.all([
  api('/api/parts/page?includeInactive=1&limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),
  office?api('/api/purchases/orders?limit=12'):Promise.resolve([])
 ]);
 const parts=loaded.concat(page.items);
 setContent(`${window.OficinaBarcode?.markup('inventory')||''}<div class="section-head"><div><h2>Estoque</h2><span class="muted">Saldos por peça e movimentações auditáveis</span></div>
  <div class="action-row">
   <button id="stockHistory" type="button" class="btn soft">Histórico de movimentos</button>
   ${office?'<button id="stocktakeOpen" type="button" class="btn soft">Inventário físico</button>':''}
   ${office?'<button id="suppliersManage" type="button" class="btn soft">Fornecedores</button><button id="purchaseNew" type="button" class="btn soft">+ Pedido de compra</button><button id="newPart" type="button" class="btn primary">+ Nova peça</button>':''}
  </div></div>
  ${table(['SKU','Descrição','Saldo','Mínimo','Preço',''],parts.map(p=>[
   esc(p.sku),`<strong>${esc(p.description)}</strong><br><small>${esc(p.category||'')}${p.barcode?' · GTIN: '+esc(p.barcode):''}</small>`,
   Number(p.quantity)<=Number(p.min_stock)?`<span class="pill orange">${p.quantity}</span>`:p.quantity,
   p.min_stock,money(p.sale_price_cents),
   office?`<button class="btn sm" data-entry="${p.id}">Movimentar</button> <button class="btn sm" data-part-edit="${p.id}">Editar</button> <button class="btn sm" data-fitments="${p.id}">Aplicações</button>`:''
  ]))}
  ${office?`<section class="card" style="margin-top:18px"><div class="section-head"><div><h2>Pedidos de compra</h2><span class="muted">Receba por etapas sem duplicar saldos</span></div><button type="button" id="allPurchaseOrders" class="btn sm">Ver todos</button></div>
   <div class="list">${orders.length?orders.map(o=>`<div class="list-item"><div><strong>${esc(o.reference||'Pedido '+String(o.id).slice(-6))}</strong> ${badge(o.status)}
    <br><small>${esc(o.supplier_name)} · ${dt(o.created_at)}</small></div>
    <button type="button" class="btn sm" data-purchase-open="${o.id}">Ver pedido</button></div>`).join(''):'<p class="empty">Nenhum pedido de compra cadastrado.</p>'}</div></section>`:''}`);
 window.OficinaBarcode?.attach($('#content [data-barcode-panel]'),async code=>{const part=await window.OficinaBarcode.findPartByCode(code,api,{includeInactive:true});if(!part)return {state:'error',message:'Código '+code+' não localizado entre os SKUs e GTINs cadastrados. Pesquise ou cadastre a peça.'};return {state:'success',message:'Peça '+part.sku+' — '+part.description+' identificada. Saldo: '+part.quantity+'. Nenhum estoque foi movimentado.'};});
 if($('#newPart'))$('#newPart').onclick=()=>partCreateModal();
 if($('#stocktakeOpen'))$('#stocktakeOpen').onclick=()=>listStocktakesModal(parts.filter(p=>Number(p.active)===1)).catch(e=>toast(e.message,true));
 $('#stockHistory').onclick=()=>openInventoryHistory().catch(e=>toast(e.message,true));
 if($('#suppliersManage'))$('#suppliersManage').onclick=()=>showSuppliersModal().catch(e=>toast(e.message,true));
 if($('#purchaseNew'))$('#purchaseNew').onclick=()=>newPurchaseOrderModal().catch(e=>toast(e.message,true));
 if($('#allPurchaseOrders'))$('#allPurchaseOrders').onclick=()=>showPurchaseOrdersList().catch(e=>toast(e.message,true));
 $$('[data-entry]').forEach(b=>b.onclick=()=>stockMoveModal(Number(b.dataset.entry),parts.find(p=>p.id===Number(b.dataset.entry))));
 $$('[data-part-edit]').forEach(b=>b.onclick=()=>editPartModal(parts.find(p=>p.id===Number(b.dataset.partEdit))));
 $$('[data-fitments]').forEach(b=>b.onclick=()=>partFitmentsModal(parts.find(p=>p.id===Number(b.dataset.fitments))));
 $$('[data-purchase-open]').forEach(b=>b.onclick=()=>openPurchaseOrder(Number(b.dataset.purchaseOpen)).catch(e=>toast(e.message,true)));
 showPagedLoadMore({cursor:page.nextCursor,loaded:parts.length,total:page.total,onMore:()=>renderInventory({cursor:page.nextCursor,loaded:parts})});
}
function partCreateModal(){const requestId=newCommandId();showModal('Nova peça',`<form class="form-stack"><div class="field-row"><label>SKU<input name="sku" required></label><label>Descrição<input name="description" required></label></div><div class="field-row three"><label>Categoria<input name="category"></label><label>Unidade<input name="unit" value="UN"></label><label>Localização<input name="location"></label></div><label>EAN/GTIN (opcional)<input name="barcode" inputmode="numeric" maxlength="24" placeholder="8, 12, 13 ou 14 dígitos"></label><div class="field-row three"><label>Custo (R$)<input name="cost" type="number" step="0.01" value="0"></label><label>Venda (R$)<input name="sale" type="number" step="0.01" value="0"></label><label>Estoque mínimo<input name="minStock" type="number" step="0.01" value="0"></label></div><button class="btn primary" type="submit">Salvar peça</button></form>`,async fd=>{const o=formObj(fd);await api('/api/parts',{method:'POST',body:{requestId,sku:o.sku,description:o.description,barcode:o.barcode,category:o.category,unit:o.unit,location:o.location,costCents:Math.round(Number(o.cost)*100),salePriceCents:Math.round(Number(o.sale)*100),minStock:Number(o.minStock)}});toast('Peça cadastrada');await refreshCurrentPage()})}
function stockMoveModal(id,p){
 const requestId=newCommandId(),admin=state.user.role==='ADMIN';
 showModal('Movimentar — '+p.description,`<form class="form-stack">
  <p class="muted">Saldo atual: <strong>${p.quantity} ${esc(p.unit)}</strong>. Movimentações ficam registradas no histórico.</p>
  <label>Tipo<select name="type" id="stockMoveType"><option value="ENTRADA">Entrada manual</option><option value="SAIDA_MANUAL">Saída manual</option>${admin?'<option value="AJUSTE">Ajuste de inventário (+/-)</option>':''}</select></label>
  <label>Quantidade<input name="quantity" type="number" step="0.01" required></label>
  <label>Motivo / observação<input name="note" id="stockMoveNote" maxlength="500"></label>
  <p class="muted" id="stockMoveHint">Para ajuste negativo, informe uma quantidade com sinal de menos. O motivo é obrigatório.</p>
  <button class="btn primary" type="submit">Registrar movimentação</button>
 </form>`,async fd=>{
  const o=formObj(fd);
  await api('/api/inventory/movements',{method:'POST',body:{
   requestId,partId:id,type:o.type,quantity:Number(o.quantity),note:o.note
  }});
  toast('Movimentação registrada');await refreshCurrentPage();
 });
 const type=$('#stockMoveType'),note=$('#stockMoveNote'),hint=$('#stockMoveHint');
 const sync=()=>{const adjust=type.value==='AJUSTE';note.required=adjust;note.minLength=adjust?5:0;hint.hidden=!adjust};
 type.addEventListener('change',sync);sync();
}

function editPartModal(p){
 const requestId=newCommandId();
 showModal('Editar peça — '+p.description,`<form class="form-stack">
  <div class="field-row"><label>SKU<input name="sku" maxlength="100" value="${esc(p.sku)}" required></label><label>Descrição<input name="description" maxlength="200" value="${esc(p.description)}" required></label></div>
  <label>EAN/GTIN (opcional)<input name="barcode" inputmode="numeric" maxlength="24" value="${esc(p.barcode||'')}" placeholder="8, 12, 13 ou 14 dígitos"></label>
  <div class="field-row three"><label>Categoria<input name="category" value="${esc(p.category||'')}"></label><label>Unidade<input name="unit" value="${esc(p.unit||'UN')}"></label><label>Localização<input name="location" value="${esc(p.location||'')}"></label></div>
  <div class="field-row three"><label>Custo (R$)<input name="cost" type="number" min="0" step="0.01" value="${Number(p.cost_cents)/100}"></label><label>Venda (R$)<input name="sale" type="number" min="0" step="0.01" value="${Number(p.sale_price_cents)/100}"></label><label>Estoque mínimo<input name="minStock" type="number" min="0" step="0.01" value="${p.min_stock}"></label></div>
  <p class="muted">A alteração de cadastro não modifica o saldo nem o histórico.</p>
  <button type="submit" class="btn primary">Salvar alterações</button>
 </form>`,async fd=>{
  const o=formObj(fd);
  await api('/api/parts/'+p.id,{method:'PATCH',body:{
   ...o,requestId,costCents:Math.round(Number(o.cost)*100),
   salePriceCents:Math.round(Number(o.sale)*100),minStock:Number(o.minStock)
  }});
  toast('Peça atualizada');await refreshCurrentPage();
 });
}

async function renderSchedule({cursor=null,loaded=[],period=null}={}){pageTitle('Agenda','PLANEJAMENTO');const from=period?new Date(period.from):new Date();if(!period)from.setDate(from.getDate()-7);const to=period?new Date(period.to):new Date();if(!period)to.setDate(to.getDate()+60);const currentPeriod={from:from.toISOString(),to:to.toISOString()};const [page,maintenanceAlerts]=await Promise.all([api(`/api/schedule/page?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&limit=50${cursor?'&cursor='+encodeURIComponent(cursor):''}`),api('/api/maintenance-alerts')]);const events=loaded.concat(page.items);setContent(`<div class="section-head"><div><h2>Agenda da oficina</h2><span class="muted">Diagnósticos, execuções, visitas e entregas</span></div>${['ADMIN','ATENDIMENTO','TECNICO'].includes(state.user.role)?`<button id="newEvent" class="btn primary">+ Novo evento</button>`:''}</div><div class="card"><div class="list">${events.length?events.map(e=>`<div class="list-item"><div><strong>${esc(e.title)}</strong> ${badge(e.type)}<br><small>${esc(e.customer_name||'')} ${e.os_number?`· OS #${e.os_number}`:''} ${e.technician_name?`· ${esc(e.technician_name)}`:''}</small></div><strong>${dt(e.starts_at)}</strong></div>`).join(''):'<div class="empty">Nenhum evento no período.</div>'}</div></div><div class="card"><h3>Manutenções preventivas a vencer ou atrasadas</h3><div class="list">${maintenanceAlerts.length?maintenanceAlerts.map(p=>`<div class="list-item"><div><strong>${esc(p.name)}</strong> · ${esc(p.brand||'')} ${esc(p.model||'')} <br><small>${esc(p.customer_name)} · ${esc(p.next_due_date||'Sem data')} · ${p.next_due_km??'—'} km · ${p.next_due_hours??'—'} h</small></div>${badge(p.status)}</div>`).join(''):'<div class="empty">Nenhuma manutenção próxima do vencimento.</div>'}</div></div>`);if($('#newEvent'))$('#newEvent').onclick=async()=>{
 try{
  const techs=await api('/api/technicians');
  eventModal({techs});
 }catch(error){toast(error.message,true);}
};showPagedLoadMore({cursor:page.nextCursor,loaded:events.length,total:page.total,onMore:()=>renderSchedule({cursor:page.nextCursor,loaded:events,period:currentPeriod})})}
function eventModal({techs}){const requestId=newCommandId();showModal('Novo evento',`<form class="form-stack"><div class="field-row"><label>Tipo<select name="type"><option>DIAGNOSTICO</option><option>EXECUCAO</option><option>VISITA</option><option>PREVISAO_ENTREGA</option><option>RETORNO</option></select></label><label>Título<input name="title" required></label></div><label>Início<input type="datetime-local" name="startsAt" required></label><div class="field-row"><label>Cliente<select name="customerId" id="eventCustomer"><option value="">—</option></select></label><label>OS<select name="workOrderId" id="eventOS"><option value="">—</option></select></label></div><label>Técnico<select name="technicianId"><option value="">—</option>${techs.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><button class="btn primary" type="submit">Agendar</button></form>`,async fd=>{const o=formObj(fd);o.startsAt=new Date(o.startsAt).toISOString();for(const k of ['customerId','workOrderId','technicianId']){if(o[k])o[k]=Number(o[k]);else delete o[k]}await api('/api/schedule',{method:'POST',body:{...o,requestId}});toast('Evento criado');await refreshCurrentPage()});
  attachPagedLookup($('#eventCustomer'),{resource:'customers',label:'cliente',empty:'Sem cliente vinculado'});
  attachPagedLookup($('#eventOS'),{resource:'work-orders',label:'ordem de serviço',empty:'Sem OS vinculada'});
}

async function renderFinance({cursor=null,loaded=[]}={}){pageTitle('Financeiro','GESTÃO FINANCEIRA');if(!['ADMIN','FINANCEIRO'].includes(state.user.role)){setContent('<div class="card"><div class="empty">Seu perfil não possui acesso ao financeiro.</div></div>');return}const from=new Date();from.setDate(1);from.setHours(0,0,0,0);const to=new Date();to.setMonth(to.getMonth()+1,0);to.setHours(23,59,59,999);const qs=`from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;const [s,page]=await Promise.all([api(`/api/finance/summary?${qs}`),api(`/api/expenses/page?${qs}&limit=50${cursor?'&cursor='+encodeURIComponent(cursor):''}`)]);const expenses=loaded.concat(page.items);setContent(`<div class="grid stats">${stat('Aprovado/vendido no mês',money(s.invoicedCents))}${stat('Recebido',money(s.receivedCents),'kpi-positive')}${stat('A receber das aprovações do mês',money(s.pendingCents))}${stat('Despesas pagas',money(s.expensesCents),'kpi-negative')}${stat('Recebido menos despesas pagas',money(s.resultCents),s.resultCents>=0?'kpi-positive':'kpi-negative')}</div><div class="section-head" style="margin-top:20px"><div><h2>Despesas</h2><span class="muted">Mês atual. Recebido e despesas: data do evento. A receber: saldo das aprovações deste mês, sem incluir aprovações anteriores. Valores comerciais não indicam notas fiscais emitidas.</span></div><div class="action-row"><button id="financeBilling" class="btn soft">Cobranças e conciliação</button><button id="newExpense" class="btn primary">+ Nova despesa</button></div></div>${table(['Descrição','Categoria','Valor','Vencimento','Pago em','OS'],expenses.map(e=>[`<strong>${esc(e.description)}</strong>`,esc(e.category||'—'),money(e.amount_cents),esc(e.due_date||'—'),e.paid_at?dt(e.paid_at):badge('PENDENTE'),e.os_number?`#${e.os_number}`:'—']))}`);$('#newExpense').onclick=()=>expenseModal();$('#financeBilling').onclick=()=>billingFinanceModal().catch(error=>toast(error.message,true));showPagedLoadMore({cursor:page.nextCursor,loaded:expenses.length,total:page.total,onMore:()=>renderFinance({cursor:page.nextCursor,loaded:expenses})})}
function expenseModal(){const requestId=newCommandId();let submittedPaidAt=null;showModal('Nova despesa',`<form class="form-stack"><div class="field-row"><label>Descrição<input name="description" required></label><label>Categoria<input name="category"></label></div><div class="field-row"><label>Valor (R$)<input name="amount" type="number" step="0.01" required></label><label>Vencimento<input name="dueDate" type="date"></label></div><label><input name="paid" type="checkbox" style="width:auto"> Marcar como paga agora</label><button class="btn primary" type="submit">Salvar despesa</button></form>`,async fd=>{const o=formObj(fd);await api('/api/expenses',{method:'POST',body:{description:o.description,category:o.category,amountCents:Math.round(Number(o.amount)*100),dueDate:o.dueDate||null,paidAt:fd.get('paid')?(submittedPaidAt??=new Date().toISOString()):null,requestId}});toast('Despesa salva');await refreshCurrentPage()})}


async function partFitmentsModal(part){
  const applications=await api('/api/parts/'+part.id+'/fitments');
  const requestId=newCommandId();
  showModal('Aplicações da peça — '+part.description,
    '<p class="muted">Compatibilidade informada pela oficina; não equivale a homologação do fabricante.</p>'+
    '<div class="list">'+(applications.length?applications.map(x=>'<div class="list-item"><strong>'+esc(x.brand_key)+' '+esc(x.model_key)+
      '</strong><small>'+esc(x.year_from||'Todos')+'–'+esc(x.year_to||'Todos')+' · '+esc(x.engine_key||'Qualquer motor')+
      ' · '+esc(x.fuel_type||'Todos combustíveis')+'</small></div>').join(''):'<p class="empty">Nenhuma aplicação cadastrada.</p>')+'</div>'+
    '<form class="form-stack"><h3>Adicionar aplicação</h3>'+
    '<div class="field-row"><label>Marca<input name="brand" required maxlength="80" placeholder="Volkswagen"></label>'+
    '<label>Modelo<input name="model" required maxlength="80" placeholder="Gol"></label></div>'+
    '<div class="field-row"><label>Ano inicial<input name="yearFrom" type="number" min="1900" max="2200"></label>'+
    '<label>Ano final<input name="yearTo" type="number" min="1900" max="2200"></label></div>'+
    '<div class="field-row"><label>Motorização<input name="engine" maxlength="100" placeholder="1.6 MSI"></label>'+
    '<label>Combustível<select name="fuelType"><option value="">Qualquer</option>'+
    ['GASOLINA','ETANOL','FLEX','DIESEL','GNV','ELETRICO','HIBRIDO','OUTRO'].map(x=>'<option>'+x+'</option>').join('')+'</select></label></div>'+
    '<label>Referência/observações<input name="notes" maxlength="500"></label>'+
    '<button class="btn primary" type="submit">Salvar aplicação</button></form>',async fd=>{
      const o=formObj(fd);
      for(const k of ['yearFrom','yearTo'])if(o[k]==='')delete o[k];else o[k]=Number(o[k]);
      await api('/api/parts/'+part.id+'/fitments',{method:'POST',body:{...o,requestId}});
      toast('Aplicação registrada');await partFitmentsModal(part);
    });
}

async function billingFinanceModal(){
 const [report,entries]=await Promise.all([
  api('/api/billing/report'),api('/api/billing/statements?limit=50')
 ]);
 showModal('Cobranças, taxas e conciliação',`<div class="form-stack">
  <div class="grid stats">
   ${stat('Parcelas recebidas',money(report.grossReceivedCents))}
   ${stat('Parcelas pendentes',money(report.pendingCents))}
   ${stat('Parcelas vencidas',money(report.overdueCents))}
   ${stat('Taxas registradas',money(report.feeCents))}
   ${stat('Repasse líquido registrado',money(report.netSettledCents))}
  </div>
  <p class="muted">O extrato associa recebimentos existentes sem duplicar receita. Lembretes são preparados automaticamente no funcionamento offline; envio só quando SMTP próprio está habilitado.</p>
  <div class="action-row"><button class="btn sm" type="button" id="prepareBillingReminders">Executar lembretes agora</button></div>
  <form id="statementForm" class="form-stack">
   <h3>Adicionar lançamento de extrato</h3>
   <div class="field-row">
    <label>Identificação da conta<input name="bankAccount" maxlength="80" required></label>
    <label>Identificador bancário único<input name="externalId" maxlength="128" required></label>
   </div>
   <div class="field-row">
    <label>Data<input type="date" name="bookedAt" value="${new Date().toISOString().slice(0,10)}" required></label>
    <label>Entrada (R$)<input type="number" name="amount" step="0.01" min="0.01" required></label>
   </div>
   <label>Descrição<input name="description" maxlength="300"></label>
   <button class="btn sm primary" type="submit">Registrar no extrato</button>
  </form>
  <form id="statementFileForm" class="form-stack">
   <h3>Importar extrato OFX ou CSV</h3>
   <div class="field-row">
    <label>Identificação da conta<input name="bankAccount" maxlength="80" required></label>
    <label>Arquivo (.ofx ou .csv)<input type="file" name="statementFile" accept=".ofx,.csv,text/csv" required></label>
   </div>
   <small class="muted">Até 1 MB ou 1.000 lançamentos. Reimportar não duplica registros. Conciliar recebimentos separadamente.</small>
   <button class="btn sm primary" type="submit">Importar arquivo</button>
  </form>
  <h3>Últimos lançamentos</h3>
  <div class="list">${entries.length?entries.map(row=>`<div class="list-item">
   <div><strong>${money(row.amount_cents)}</strong> · ${esc(row.bank_account)}<br>
    <small>${esc(row.booked_at)} · ${esc(row.description)}</small></div>
   ${row.receipt_id?`<span class="muted">Conciliado #${row.receipt_id}</span>`:
    `<button type="button" class="btn sm" data-match-entry="${row.id}">Conciliar</button>`}
  </div>`).join(''):'<p class="muted">Nenhum lançamento importado</p>'}</div>
 </div>`);
 const reminders=$('#prepareBillingReminders');
 if(reminders)reminders.onclick=async()=>{
  try{
   const result=await api('/api/billing/reminders/run',{method:'POST',body:{daysAhead:3}});
   toast(result.disabled
    ?result.prepared+' rascunho(s). SMTP não habilitado; nenhum e-mail enviado.'
    :result.sent+' e-mail(s) enviado(s); '+(result.uncertain||0)+' requer(em) conferência.');
  }catch(error){toast(error.message,true)}
 };
 const fileForm=$('#statementFileForm');
 if(fileForm)fileForm.onsubmit=async e=>{
  e.preventDefault();
  try{
   const fd=new FormData(fileForm),file=fd.get('statementFile');
   if(!file||!file.name||file.size>1024*1024)throw Error('Selecione um OFX ou CSV até 1 MB');
   const ext=file.name.toLowerCase().split('.').at(-1);
   if(!['csv','ofx'].includes(ext))throw Error('Formato suportado: .csv ou .ofx');
   const result=await api('/api/billing/statements/import',{method:'POST',body:{
    bankAccount:String(fd.get('bankAccount')||''),
    format:ext.toUpperCase(),content:await file.text()
   }});
   toast(result.imported+' lançamento(s) importado(s); '+result.repeated+' já existia(m).');
   await billingFinanceModal();
  }catch(error){toast(error.message,true)}
 };
 const statement=$('#statementForm');
 if(statement)statement.onsubmit=async e=>{
  e.preventDefault();
  try{
   const fd=new FormData(statement),amountCents=Math.round(Number(fd.get('amount'))*100);
   await api('/api/billing/statements',{method:'POST',body:{
    bankAccount:fd.get('bankAccount'),externalId:fd.get('externalId'),
    bookedAt:fd.get('bookedAt'),amountCents,description:fd.get('description')
   }});
   toast('Lançamento de extrato registrado');await billingFinanceModal();
  }catch(error){toast(error.message,true)}
 };
 document.querySelectorAll('[data-match-entry]').forEach(btn=>btn.onclick=async()=>{
  try{
   const receipts=await api('/api/billing/receipts/available?limit=100');
   const bank=entries.find(x=>x.id===btn.dataset.matchEntry);
   const possible=receipts.filter(x=>Number(x.amount_cents)===Number(bank?.amount_cents));
   if(!possible.length){toast('Não há recebimentos de mesmo valor para conciliar',true);return;}
   showModal('Conciliar com recebimento da OS',`<form class="form-stack">
    <p>Extrato: <strong>${money(bank.amount_cents)}</strong> · ${esc(bank.booked_at)}</p>
    <label>Selecione a OS e o recebimento
     <select name="receiptId" required>${possible.map(r=>`<option value="${r.id}">OS #${r.os_number} · ${esc(r.customer_name)} · ${money(r.amount_cents)} (${esc(r.method)})</option>`).join('')}</select>
    </label><button type="submit" class="btn primary">Conciliar</button></form>`,async fd=>{
     await api('/api/billing/statements/'+btn.dataset.matchEntry+'/match',{
      method:'POST',body:{receiptId:Number(fd.get('receiptId'))}
     });
     toast('Extrato conciliado sem duplicar receita');await billingFinanceModal();
   });
  }catch(error){toast(error.message,true)}
 });
}
