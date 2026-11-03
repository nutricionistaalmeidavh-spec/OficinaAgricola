// Interface fiscal: o rascunho NÃO é uma nota autorizada.
// Somente o servidor pode criar snapshots; o renderer nunca grava livros canônicos.
async function renderFiscal(){
  pageTitle('Fiscal','DOCUMENTOS E CONCILIAÇÃO');
  const docs=await api('/api/fiscal');
  const cards=docs.map(d=>{
    const origin=d.origin_type==='OS'?'OS':'Venda';
    const actions=d.status==='RASCUNHO'
      ? '<button class="btn sm" data-fiscal-submit="'+d.id+'">Transmitir</button>'
      : d.status==='INDETERMINADO'
        ? '<button class="btn sm" data-fiscal-check="'+d.id+'">Consultar situação</button>'
        : '';
    return '<div class="list-item"><div><strong>'+esc(d.kind)+' #'+d.id+'</strong> · '+origin+' #'+d.origin_id+
      '<br><small>'+esc(d.status)+' · '+money(d.amount_cents)+'</small></div><div class="action-row">'+
      '<button class="btn sm soft" data-fiscal-details="'+d.id+'">Histórico</button>'+actions+'</div></div>';
  }).join('');
  setContent('<div class="section-head"><div><h2>Documentos fiscais</h2>'+
    '<span class="muted">Rascunhos e protocolos vinculados à operação canônica</span></div>'+
    '<button id="fiscalNew" class="btn primary">+ Preparar documento</button></div>'+
    '<div class="card"><p><strong>Emissão efetiva:</strong> exige certificado/credenciamento, classificação tributária e um emissor local validado. '+
    'Um rascunho ou um envio sem confirmação não substitui NF-e ou NFS-e autorizada.</p></div>'+
    '<div class="card"><div class="card-head"><h2>Registro fiscal</h2><small>'+docs.length+' documento(s) recente(s)</small></div>'+
    '<div class="list">'+(cards||'<div class="empty">Nenhum documento fiscal preparado.</div>')+'</div></div>');
  $('#fiscalNew').onclick=()=>fiscalDraftModal();
  $$('[data-fiscal-details]').forEach(b=>b.onclick=()=>showFiscalHistory(Number(b.dataset.fiscalDetails)).catch(e=>toast(e.message,true)));
  $$('[data-fiscal-submit]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalSubmit),'submit'));
  $$('[data-fiscal-check]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalCheck),'reconcile'));
}
function fiscalDraftModal(){
  showModal('Preparar documento fiscal',
    '<form class="form-stack">'+
    '<p class="muted">O documento será criado como rascunho imutável, ainda sem autorização fiscal.</p>'+
    '<label>Origem<select name="originType"><option value="OS">Ordem de Serviço</option><option value="SALE">Venda de balcão</option></select></label>'+
    '<label>ID interno da OS/venda<input name="originId" type="number" min="1" step="1" required></label>'+
    '<label>Documento<select name="kind"><option value="NFE">NF-e — peças</option><option value="NFSE">NFS-e — mão de obra</option></select></label>'+
    '<button class="btn primary" type="submit">Criar rascunho</button></form>',
    async form=>{
      const values=formObj(form);
      const body={originType:values.originType,originId:Number(values.originId),kind:values.kind,requestId:newCommandId()};
      await api('/api/fiscal/drafts',{method:'POST',body});
      toast('Rascunho fiscal criado. Não é uma nota autorizada.');
      await refreshCurrentPage();
    });
}
async function fiscalAction(id,action){
  try{
    await api('/api/fiscal/'+id+'/'+action,{method:'POST',body:{requestId:newCommandId()}});
    await refreshCurrentPage();
  }catch(error){
    toast(error.message,true);
    // Falhas de rede podem deixar status indeterminado; atualiza sem tentar reenviar às cegas.
    await refreshCurrentPage().catch(()=>{});
  }
}
async function showFiscalHistory(id){
  const [doc,events]=await Promise.all([api('/api/fiscal/'+id),api('/api/fiscal/'+id+'/events')]);
  const rows=events.map(e=>'<div class="list-item"><div><strong>'+esc(e.event_type)+'</strong><br><small>'+dt(e.created_at)+'</small></div></div>').join('');
  showModal('Documento fiscal #'+doc.id,
    '<div class="detail-grid"><div class="detail-block"><h3>Status</h3>'+esc(doc.status)+'</div>'+
    '<div class="detail-block"><h3>Total</h3>'+money(doc.amount_cents)+'</div></div>'+
    '<p><strong>Origem:</strong> '+esc(doc.origin_type)+' #'+doc.origin_id+'</p>'+
    (doc.access_key?'<p><strong>Chave:</strong> '+esc(doc.access_key)+'</p>':'')+
    (doc.protocol?'<p><strong>Protocolo:</strong> '+esc(doc.protocol)+'</p>':'')+
    (doc.last_error?'<p class="error">'+esc(doc.last_error)+'</p>':'')+
    '<h3>Eventos</h3><div class="list">'+(rows||'<div class="empty">Nenhum evento.</div>')+'</div>');
}
