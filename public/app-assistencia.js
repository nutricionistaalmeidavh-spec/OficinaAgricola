async function renderServices() {
  pageTitle('Serviços', 'CADASTROS');
  const rows = await api('/api/services?includeInactive=1');
  const canEdit = ['ADMIN', 'ATENDIMENTO'].includes(state.user.role);
  setContent(`<div class="section-head"><div><h2>Catálogo de serviços</h2><span class="muted">Mão de obra e serviços padronizados para orçamento e venda</span></div>${canEdit ? '<button id="newService" class="btn primary">+ Novo serviço</button>' : ''}</div>
    ${table(['Código','Serviço','Preço','Tempo estimado','Situação',''], rows.map(service => [
      esc(service.code),
      `<strong>${esc(service.name)}</strong><br><small>${esc(service.description || '')}</small>`,
      money(service.price_cents),
      service.estimated_minutes ? `${service.estimated_minutes} min` : '—',
      service.active ? badge('ATIVO') : badge('INATIVO'),
      canEdit ? `<button class="btn sm" data-edit-service="${service.id}">Editar</button>` : '',
    ]))}`);
  const create = $('#newService');
  if (create) create.onclick = () => serviceModal();
  $$('[data-edit-service]').forEach(button => button.onclick = () => serviceModal(rows.find(item => item.id === Number(button.dataset.editService))));
}

function serviceModal(service = {}) {
  const requestId=newCommandId();
  showModal(service.id ? 'Editar serviço' : 'Novo serviço', `<form class="form-stack">
    <div class="field-row"><label>Código<input name="code" required value="${esc(service.code || '')}"></label><label>Nome<input name="name" required value="${esc(service.name || '')}"></label></div>
    <label>Descrição<textarea name="description">${esc(service.description || '')}</textarea></label>
    <div class="field-row"><label>Preço padrão (R$)<input name="price" type="number" min="0" step="0.01" value="${service.price_cents != null ? service.price_cents / 100 : 0}"></label><label>Tempo estimado (min)<input name="minutes" type="number" min="0" step="1" value="${service.estimated_minutes || 0}"></label></div>
    ${service.id ? `<label>Situação<select name="active"><option value="1" ${service.active ? 'selected' : ''}>Ativo</option><option value="0" ${!service.active ? 'selected' : ''}>Inativo</option></select></label>` : ''}
    <button class="btn primary" type="submit">Salvar serviço</button>
  </form>`, async fd => {
    const data = formObj(fd);
    const body = { requestId, code: data.code, name: data.name, description: data.description, priceCents: Math.round(Number(data.price || 0) * 100), estimatedMinutes: Number(data.minutes || 0) };
    if (service.id) body.active = data.active === '1';
    await api(service.id ? `/api/services/${service.id}` : '/api/services', { method: service.id ? 'PATCH' : 'POST', body });
    toast('Serviço salvo');
    await refreshCurrentPage();
  });
}

async function renderSales() {
  pageTitle('Vendas & Caixa', 'BALCÃO');
  if (!['ADMIN', 'ATENDIMENTO', 'FINANCEIRO'].includes(state.user.role)) {
    setContent('<div class="card"><div class="empty">Seu perfil não possui acesso a vendas e caixa.</div></div>');
    return;
  }
  const [sales, cash] = await Promise.all([api('/api/sales?limit=80'), api('/api/cash/current/summary')]);
  const open = cash.session;
  const canCash = ['ADMIN', 'ATENDIMENTO', 'FINANCEIRO'].includes(state.user.role);
  setContent(`
    <div class="grid stats">
      ${stat('Caixa', open ? 'ABERTO' : 'FECHADO', open ? 'kpi-positive' : '')}
      ${stat('Saldo inicial', money(open?.opening_cents || 0))}
      ${stat('Esperado em dinheiro', money(cash.expectedCashCents || 0))}
      ${stat('Movimentos do caixa', money(cash.movementTotalCents || 0))}
    </div>
    <div class="section-head" style="margin-top:20px"><div><h2>Operação de balcão</h2><span class="muted">Venda de peças e serviços com baixa de estoque e vínculo ao caixa</span></div><div class="action-row">
      ${!open && canCash ? '<button id="openCash" class="btn soft">Abrir caixa</button>' : ''}
      ${open ? '<button id="newSale" class="btn primary">+ Nova venda</button>' : ''}
      ${open && canCash ? '<button id="cashMove" class="btn soft">Movimentar caixa</button><button id="closeCash" class="btn">Fechar caixa</button>' : ''}
    </div></div>
    ${!open ? '<div class="card"><div class="empty">Abra o caixa para iniciar vendas de balcão.</div></div>' : ''}
    <div class="section-head" style="margin-top:20px"><div><h2>Vendas recentes</h2><span class="muted">${sales.length} registro(s)</span></div></div>
    ${table(['Venda','Data','Cliente','Pagamento','Total','Situação',''], sales.map(sale => [
      `<strong>#${sale.sale_number}</strong>`, dt(sale.created_at), esc(sale.customer_name || 'Consumidor'), esc(sale.payment_method), money(sale.total_cents), badge(sale.status), `<button class="btn sm" data-sale="${sale.id}">Detalhes</button>`
    ]))}`);

  const openButton = $('#openCash'); if (openButton) openButton.onclick = openCashModal;
  const saleButton = $('#newSale'); if (saleButton) saleButton.onclick = () => saleModal();
  const moveButton = $('#cashMove'); if (moveButton) moveButton.onclick = cashMoveModal;
  const closeButton = $('#closeCash'); if (closeButton) closeButton.onclick = () => closeCashModal(cash.expectedCashCents || 0);
  $$('[data-sale]').forEach(button => button.onclick = () => saleDetails(button.dataset.sale));
}

async function saleModal() {
  // Mesma chave em todos os retries deste formulário (inclusive após timeout HTTP).
  const requestId = globalThis.crypto?.randomUUID?.() || `sale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [parts, services, customers] = await Promise.all([api('/api/parts'), api('/api/services'), api('/api/customers')]);
  const options = [
    ...parts.filter(p => p.active).map(p => ({ value: `P:${p.id}`, label: `Peça · ${p.sku} — ${p.description} · ${money(p.sale_price_cents)} · estoque ${p.quantity}` })),
    ...services.filter(s => s.active).map(s => ({ value: `S:${s.id}`, label: `Serviço · ${s.code} — ${s.name} · ${money(s.price_cents)}` })),
  ];
  if (!options.length) { toast('Cadastre uma peça ou serviço antes da venda.', true); return; }
  showModal('Nova venda de balcão', `<form class="form-stack">
    <label>Cliente<select name="customerId"><option value="">Consumidor</option>${customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    <div class="card-head"><strong>Itens</strong><button type="button" class="btn sm soft" id="addSaleItem">+ Item</button></div>
    <div id="saleItems"></div>
    <div class="field-row"><label>Desconto (R$)<input name="discount" type="number" min="0" step="0.01" value="0"></label><label>Pagamento<select name="paymentMethod"><option>DINHEIRO</option><option>PIX</option><option>CARTAO_DEBITO</option><option>CARTAO_CREDITO</option><option>TRANSFERENCIA</option></select></label></div>
    <label>Observação<input name="note"></label>
    <button class="btn primary" type="submit">Concluir venda</button>
  </form>`, async fd => {
    const items = $$('.sale-item-row').map(row => {
      const [kind, id] = $('[data-sale-select]', row).value.split(':');
      const quantity = Number($('[data-sale-qty]', row).value);
      return kind === 'P' ? { partId: Number(id), quantity } : { serviceId: Number(id), quantity };
    });
    if (!items.length) throw new Error('Inclua ao menos um item');
    const customerId = fd.get('customerId');
    await api('/api/sales', { method: 'POST', body: {
      requestId,
      customerId: customerId ? Number(customerId) : null,
      discountCents: Math.round(Number(fd.get('discount') || 0) * 100),
      paymentMethod: fd.get('paymentMethod'),
      note: fd.get('note'),
      items,
    }});
    toast('Venda concluída e estoque atualizado');
    await refreshCurrentPage();
  });
  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'field-row sale-item-row';
    row.innerHTML = `<label>Item<select data-sale-select>${options.map(item => `<option value="${item.value}">${esc(item.label)}</option>`).join('')}</select></label><label>Quantidade<input data-sale-qty type="number" min="0.01" step="0.01" value="1"></label><button type="button" class="btn danger sm" data-remove-sale>Remover</button>`;
    $('#saleItems').appendChild(row);
    $('[data-remove-sale]', row).onclick = () => row.remove();
  };
  addRow();
  $('#addSaleItem').onclick = addRow;
}

async function saleDetails(id) {
  const sale = await api(`/api/sales/${id}`);
  const canCancel = ['ADMIN', 'FINANCEIRO'].includes(state.user.role) && sale.status === 'CONCLUIDA';
  showModal(`Venda #${sale.sale_number}`, `<div class="detail-grid"><div class="detail-block"><h3>Resumo</h3><p>${dt(sale.created_at)}<br>${esc(sale.customer_name || 'Consumidor')}<br>${esc(sale.payment_method)}</p>${badge(sale.status)}</div><div class="detail-block"><h3>Total</h3><strong>${money(sale.total_cents)}</strong><p class="muted">Subtotal ${money(sale.subtotal_cents)} · desconto ${money(sale.discount_cents)}</p></div></div><div class="list" style="margin-top:14px">${sale.items.map(item => `<div class="list-item"><div><strong>${esc(item.description)}</strong><br><small>${item.quantity} × ${money(item.unit_price_cents)}</small></div><strong>${money(item.total_cents)}</strong></div>`).join('')}</div>${canCancel ? '<button id="cancelSale" type="button" class="btn danger" style="margin-top:14px">Cancelar venda e estornar estoque</button>' : ''}`);
  const cancel = $('#cancelSale');
  if (cancel) cancel.onclick = () => cancelSaleModal(sale);
}

function cancelSaleModal(sale) {
  const requestId = newCommandId();
  showModal(`Confirmar cancelamento da venda #${sale.sale_number}`,
    `<form class="form-stack">
      <p><strong>Venda #${esc(sale.sale_number)} · ${money(sale.total_cents)}</strong></p>
      <p class="muted">Esta ação cancela a venda, estorna os itens de estoque e registra o estorno financeiro no caixa aberto. A venda permanece no histórico.</p>
      <label>Motivo do cancelamento
        <textarea name="reason" required minlength="3" maxlength="500" placeholder="Descreva por que a venda será cancelada"></textarea>
      </label>
      <div class="action-row">
        <button type="button" id="keepSale" class="btn">Manter venda</button>
        <button type="submit" class="btn danger">Confirmar cancelamento e estorno</button>
      </div>
    </form>`,
    async fd => {
      const reason = String(fd.get('reason') || '').trim();
      if (reason.length < 3) throw new Error('Motivo do cancelamento obrigatório (mínimo 3 caracteres)');
      const result = await api(`/api/sales/${sale.id}/cancel`, {
        method: 'POST', body: { reason, requestId }
      });
      if (result.status !== 'CANCELADA') throw new Error('Cancelamento não confirmado. Consulte o histórico.');
      toast(`Venda #${sale.sale_number} cancelada e estornos registrados.`);
      await refreshCurrentPage();
    });
  $('#keepSale').onclick = () => closeModal();
}

function openCashModal() {
  const requestId=newCommandId();
  showModal('Abrir caixa', `<form class="form-stack"><label>Saldo inicial (R$)<input name="opening" type="number" min="0" step="0.01" value="0"></label><label>Observação<input name="note"></label><button class="btn primary" type="submit">Abrir caixa</button></form>`, async fd => {
    await api('/api/cash/open', { method: 'POST', body: { requestId, openingCents: Math.round(Number(fd.get('opening') || 0) * 100), note: fd.get('note') } });
    toast('Caixa aberto'); await refreshCurrentPage();
  });
}

function cashMoveModal() {
  const requestId=newCommandId();
  showModal('Movimentar caixa', `<form class="form-stack"><label>Tipo<select name="type"><option value="SUPRIMENTO">Suprimento</option><option value="SANGRIA">Sangria</option><option value="AJUSTE">Ajuste positivo</option></select></label><label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Observação<input name="note"></label><button class="btn primary" type="submit">Registrar</button></form>`, async fd => {
    await api('/api/cash/current/movements', { method: 'POST', body: { requestId, type: fd.get('type'), amountCents: Math.round(Number(fd.get('amount')) * 100), note: fd.get('note') } });
    toast('Movimentação registrada'); await refreshCurrentPage();
  });
}

function closeCashModal(expectedCents) {
  const requestId=newCommandId();
  showModal('Fechar caixa', `<form class="form-stack"><p>Valor esperado em dinheiro: <strong>${money(expectedCents)}</strong></p><label>Valor contado (R$)<input name="closing" type="number" min="0" step="0.01" placeholder="Informe o valor contado" required></label><label>Observação<input name="note"></label><button class="btn primary" type="submit">Fechar caixa</button></form>`, async fd => {
    const result = await api('/api/cash/current/close', { method: 'POST', body: { requestId, closingCents: Math.round(Number(fd.get('closing')) * 100), note: fd.get('note') } });
    toast(`Caixa fechado. Diferença: ${money(result.difference_cents)}`); await refreshCurrentPage();
  });
}
