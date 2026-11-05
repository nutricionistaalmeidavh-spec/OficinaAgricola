// Inventory UI operates exclusively through canonical server APIs, not local stock math.
async function openInventoryHistory(){
 let cursor=null;
 showModal('Histórico de movimentações',`<div class="form-stack">
  <p class="muted">Entradas, saídas, peças consumidas na OS, ajustes e estornos. Registros não podem ser apagados nesta tela.</p>
  <div class="field-row">
   <label>Tipo<select id="inventoryHistoryType">
    <option value="">Todos os movimentos</option><option value="ENTRADA">Entradas</option>
    <option value="SAIDA_MANUAL">Saídas</option><option value="CONSUMO_OS">Consumo OS</option>
    <option value="AJUSTE">Ajustes</option><option value="ESTORNO">Estornos</option>
   </select></label>
   <label>Pesquisar peça/SKU<input id="inventoryHistorySearch" type="search" maxlength="100" placeholder="Descrição ou SKU"></label>
  </div>
  <div class="field-row"><label>De<input id="inventoryHistoryFrom" type="date"></label>
   <label>Até<input id="inventoryHistoryTo" type="date"></label></div>
  <button type="button" class="btn soft" id="inventoryHistoryFilter">Aplicar filtros</button>
  <div class="list" id="inventoryHistoryRows" aria-live="polite"></div>
  <button type="button" class="btn soft hidden" id="inventoryHistoryMore">Carregar mais movimentações</button>
 </div>`);
 // Filter controls are read-only; changing them must not trigger an unsaved-form warning.
 $('#modalBody').oninput=()=>{if(modalSession)modalSession.dirty=false};
 $('#modalBody').onchange=$('#modalBody').oninput;
 const rowHost=$('#inventoryHistoryRows'),more=$('#inventoryHistoryMore');
 const load=async (append=false)=>{
  if(!append)cursor=null;
  const search=$('#inventoryHistorySearch').value.trim(),type=$('#inventoryHistoryType').value;
  const from=$('#inventoryHistoryFrom').value,to=$('#inventoryHistoryTo').value;
  if(from&&to&&from>to){toast('A data final deve ser igual ou posterior à inicial',true);return}
  const query=new URLSearchParams({limit:'25'});
  if(search)query.set('search',search);
  if(type)query.set('type',type);
  if(from)query.set('from',new Date(from+'T00:00:00').toISOString());
  if(to)query.set('to',new Date(to+'T23:59:59.999').toISOString());
  if(append&&cursor)query.set('cursor',String(cursor));
  more.disabled=true;
  try{
   const result=await api('/api/inventory/history?'+query.toString());
   const rows=result.items.map(m=>{
    const delta=Number(m.quantity_delta),sign=delta>0?'+':'';
    const source=m.source_type==='PURCHASE_RECEIPT_LINE'?' · Compra recebida':
     m.work_order_id?' · OS #'+m.work_order_id:'';
    return `<div class="list-item"><div><strong>${esc(m.sku)} · ${esc(m.description)}</strong>
     <br><small>${dt(m.created_at)} · ${esc(m.type)}${esc(source)}</small>
     <br><small>${esc(m.note||'Sem observação')} · ${esc(m.author_name||('Usuário #'+(m.created_by??'—')))}</small></div>
     <strong>${sign}${delta}</strong></div>`;
   }).join('');
   if(!append)rowHost.innerHTML=rows||'<p class="empty">Nenhum movimento com esses filtros.</p>';
   else rowHost.insertAdjacentHTML('beforeend',rows);
   cursor=result.nextCursor;
   more.classList.toggle('hidden',!cursor);
  }finally{more.disabled=false}
 };
 $('#inventoryHistoryFilter').onclick=()=>load().catch(e=>toast(e.message,true));
 more.onclick=()=>load(true).catch(e=>toast(e.message,true));
 await load();
}

async function showSuppliersModal(){
 const suppliers=await api('/api/suppliers?limit=100');
 showModal('Fornecedores',`<div class="form-stack">
  <p class="muted">Cadastre fornecedores locais para vincular aos pedidos de compra. Sem integração paga.</p>
  <button class="btn primary" type="button" id="supplierNew">+ Novo fornecedor</button>
  <div class="list">${suppliers.length?suppliers.map(s=>`<div class="list-item"><div>
   <strong>${esc(s.name)}</strong><br><small>${esc(s.document||'Sem documento')} · ${esc(s.phone||'Sem telefone')}</small></div></div>`).join(''):'<p class="empty">Nenhum fornecedor cadastrado.</p>'}</div>
 </div>`);
 $('#supplierNew').onclick=()=>newSupplierModal();
}
function newSupplierModal(){
 const requestId=newCommandId();
 showModal('Novo fornecedor',`<form class="form-stack">
  <label>Nome / razão social<input name="name" required minlength="2" maxlength="160"></label>
  <div class="field-row"><label>CPF/CNPJ (opcional)<input name="document" maxlength="32"></label>
   <label>Telefone<input name="phone" type="tel" maxlength="40"></label></div>
  <label>E-mail<input name="email" type="email" maxlength="160"></label>
  <button type="submit" class="btn primary">Cadastrar fornecedor</button>
 </form>`,async fd=>{
  await api('/api/suppliers',{method:'POST',body:{...formObj(fd),requestId}});
  toast('Fornecedor cadastrado');await refreshCurrentPage();
 });
}

async function newPurchaseOrderModal(){
 const suppliers=await api('/api/suppliers?limit=100');
 if(!suppliers.length){
  toast('Cadastre primeiro um fornecedor');
  newSupplierModal();return;
 }
 const requestId=newCommandId();
 showModal('Novo pedido de compra',`<form class="form-stack">
  <label>Fornecedor<select name="supplierId" required>
   <option value="">Selecione o fornecedor</option>
   ${suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
  </select></label>
  <label>Referência (opcional)<input name="reference" maxlength="120" placeholder="Pedido ou número do fornecedor"></label>
  <div class="section-head"><h3>Peças solicitadas</h3><button type="button" class="btn sm" id="purchaseAddPart">+ Adicionar peça</button></div>
  <div id="purchaseItemRows" class="form-stack"></div>
  <label>Observação<input name="note" maxlength="1000"></label>
  <p class="muted">Criar um pedido não altera o estoque. O saldo aumenta somente no recebimento confirmado.</p>
  <button type="submit" class="btn primary">Criar pedido de compra</button>
 </form>`,async fd=>{
  const items=$$('[data-purchase-item]').map(row=>({
   partId:Number(row.querySelector('[data-part-id]').value),
   quantity:Number(row.querySelector('[data-purchase-qty]').value),
   costCents:Math.round(Number(row.querySelector('[data-purchase-cost]').value)*100)
  }));
  if(items.some(i=>!i.partId||!Number.isFinite(i.quantity)||i.quantity<=0||i.costCents<0))
   throw new Error('Revise as peças, quantidades e custos');
  await api('/api/purchases/orders',{method:'POST',body:{
   requestId,supplierId:Number(fd.get('supplierId')),
   reference:fd.get('reference'),note:fd.get('note'),items
  }});
  toast('Pedido registrado; aguardando recebimento');await refreshCurrentPage();
 });
 const host=$('#purchaseItemRows'),add=$('#purchaseAddPart');
 const addRow=()=>{
  if(host.children.length>=100)return;
  const el=document.createElement('div');el.className='card';el.setAttribute('data-purchase-item','');
  el.innerHTML=`<div class="field-row three">
   <label>Peça<select data-part-id required><option value="">Pesquisar peça</option></select></label>
   <label>Quantidade<input data-purchase-qty type="number" min="0.01" step="0.01" value="1" required></label>
   <label>Custo unitário (R$)<input data-purchase-cost type="number" min="0" step="0.01" value="0" required></label>
  </div><button type="button" class="btn sm" data-remove-part>Remover</button>`;
  host.append(el);
  attachPagedLookup(el.querySelector('[data-part-id]'),
   {resource:'parts',label:'peça',placeholder:'Buscar SKU ou descrição'});
  el.querySelector('[data-remove-part]').onclick=()=>{if(host.children.length>1)el.remove()};
 };
 add.onclick=addRow;addRow();
}

async function openPurchaseOrder(orderId){
 const order=await api('/api/purchases/orders/'+orderId);
 const pending=order.items.filter(x=>Number(x.received_quantity)<Number(x.quantity));
 const requestId=newCommandId();
 showModal('Pedido de compra',`<div class="form-stack">
  <div class="card"><strong>${esc(order.reference||'Pedido '+String(order.id).slice(-6))}</strong>
   ${badge(order.status)}<br><small>${esc(order.supplier_name)} · ${dt(order.created_at)}</small></div>
  <div class="list">${order.items.map(x=>`<div class="list-item"><div><strong>${esc(x.sku)} · ${esc(x.description)}</strong>
   <br><small>Pedido: ${x.quantity} · Recebido: ${x.received_quantity} · Custo unit.: ${money(x.cost_cents)}</small></div></div>`).join('')}</div>
  ${pending.length?`<form class="form-stack">
   <h3>Registrar recebimento</h3>
   <p class="muted">Informe as quantidades que chegaram. Pode receber parcialmente; saldo e auditoria são gravados juntos.</p>
   ${pending.map(x=>`<label>${esc(x.sku)} · ${esc(x.description)} — pendente: ${Number(x.quantity)-Number(x.received_quantity)}
    <input data-receive-item="${x.id}" type="number" min="0" max="${Number(x.quantity)-Number(x.received_quantity)}"
     step="0.01" value="${Number(x.quantity)-Number(x.received_quantity)}" required></label>`).join('')}
   <label>Observação<input name="note" maxlength="1000" placeholder="NF do fornecedor, conferência, entrega parcial..."></label>
   <button type="submit" class="btn primary">Confirmar recebimento</button>
  </form>`:'<p class="muted">Pedido sem quantidades pendentes de recebimento.</p>'}
 </div>`,pending.length?async fd=>{
  const items=$$('[data-receive-item]').map(el=>({itemId:Number(el.dataset.receiveItem),quantity:Number(el.value)}))
   .filter(x=>Number.isFinite(x.quantity)&&x.quantity>0);
  if(!items.length)throw new Error('Informe ao menos uma quantidade recebida');
  await api('/api/purchases/orders/'+orderId+'/receipts',{method:'POST',body:{
   requestId,note:fd.get('note'),items
  }});
  toast('Recebimento confirmado e estoque atualizado');await refreshCurrentPage();
 }:null);
}

async function showPurchaseOrdersList(){
 const orders=await api('/api/purchases/orders?limit=100');
 showModal('Pedidos de compra',`<div class="list">${orders.length?orders.map(o=>`<div class="list-item">
  <div><strong>${esc(o.reference||'Pedido '+String(o.id).slice(-6))}</strong> ${badge(o.status)}
  <br><small>${esc(o.supplier_name)} · ${dt(o.created_at)}</small></div>
  <button type="button" class="btn sm" data-order-id="${o.id}">Abrir</button>
 </div>`).join(''):'<p class="empty">Nenhum pedido registrado.</p>'}</div>`);
 $$('[data-order-id]').forEach(b=>b.onclick=()=>openPurchaseOrder(Number(b.dataset.orderId)).catch(e=>toast(e.message,true)));
}
