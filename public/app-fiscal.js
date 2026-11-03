// Interface fiscal: o rascunho NÃO é uma nota autorizada.
// Somente o servidor pode criar snapshots; o renderer nunca grava livros canônicos.
async function renderFiscal(){
  pageTitle('Fiscal','DOCUMENTOS E CONCILIAÇÃO');
  const [docs,settings]=await Promise.all([api('/api/fiscal'),api('/api/fiscal/settings')]);
  const cards=docs.map(d=>{
    const origin=d.origin_type==='OS'?'OS':'Venda';
    const actions=d.status==='RASCUNHO'&&settings.enabled
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
    '<div class="action-row">'+(state.user.role==='ADMIN'?'<button id="fiscalSettings" class="btn">Configuração fiscal</button>':'')+
    '<button id="fiscalNew" class="btn primary">+ Preparar documento</button></div></div>'+
    '<div class="card"><p><strong>Cadastro fiscal:</strong> '+(settings.enabled?'Habilitado':'Desabilitado')+' · '+esc(settings.environment)+
    ' · CNPJ '+esc(settings.issuer_cnpj||'não informado')+'</p><p><strong>Emissão efetiva:</strong> exige certificado/credenciamento, classificação tributária e um emissor local validado. '+
    'Um rascunho ou um envio sem confirmação não substitui NF-e ou NFS-e autorizada.</p></div>'+
    '<div class="card"><div class="card-head"><h2>Registro fiscal</h2><small>'+docs.length+' documento(s) recente(s)</small></div>'+
    '<div class="list">'+(cards||'<div class="empty">Nenhum documento fiscal preparado.</div>')+'</div></div>');
  $('#fiscalNew').onclick=()=>fiscalDraftModal();
  if($('#fiscalSettings'))$('#fiscalSettings').onclick=()=>fiscalSettingsModal(settings);
  $$('[data-fiscal-details]').forEach(b=>b.onclick=()=>showFiscalHistory(Number(b.dataset.fiscalDetails)).catch(e=>toast(e.message,true)));
  $$('[data-fiscal-submit]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalSubmit),'submit'));
  $$('[data-fiscal-check]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalCheck),'reconcile'));
}

function fiscalSettingsModal(current){
  const selected=(value,expected)=>value===expected?' selected':'';
  const safe=value=>esc(value||'');
  showModal('Configuração fiscal da empresa',
    '<form class="form-stack">'+
    '<p class="muted">Somente dados cadastrais. Nunca informe certificado digital, senha ou chave privada nesta tela.</p>'+
    '<label>CNPJ emissor<input name="issuerCnpj" value="'+safe(current.issuer_cnpj)+'" inputmode="numeric" maxlength="18"></label>'+
    '<div class="field-row"><label>UF<input name="issuerUf" maxlength="2" value="'+safe(current.issuer_uf)+'"></label>'+
    '<label>Município IBGE<input name="municipalityIbge" inputmode="numeric" maxlength="7" value="'+safe(current.municipality_ibge)+'"></label></div>'+
    '<div class="field-row"><label>Inscrição estadual<input name="stateRegistration" value="'+safe(current.state_registration)+'"></label>'+
    '<label>Inscrição municipal<input name="municipalRegistration" value="'+safe(current.municipal_registration)+'"></label></div>'+
    '<label>Regime tributário<select name="taxRegime">'+
    '<option value="">Selecione</option>'+
    ['MEI','SIMPLES','NORMAL'].map(s=>'<option value="'+s+'"'+selected(current.tax_regime,s)+'>'+s+'</option>').join('')+
    '</select></label>'+
    '<label>Ambiente<select name="environment">'+
    '<option value="HOMOLOGACAO"'+selected(current.environment,'HOMOLOGACAO')+'>Homologação (sem valor fiscal)</option>'+
    '<option value="PRODUCAO"'+selected(current.environment,'PRODUCAO')+'>Produção</option></select></label>'+
    '<label><input type="checkbox" name="enabled"'+(current.enabled?' checked':'')+'> Habilitar transmissão após configurar emissor local</label>'+
    '<label><input type="checkbox" name="productionConfirmed"'+(current.production_confirmed?' checked':'')+'> Confirmo a configuração de produção (não equivale a credenciamento)</label>'+
    '<button class="btn primary" type="submit">Salvar configuração</button></form>',
    async form=>{
      const o=formObj(form);
      await api('/api/fiscal/settings',{method:'PATCH',body:{
        issuerCnpj:o.issuerCnpj,issuerUf:o.issuerUf,municipalityIbge:o.municipalityIbge,
        stateRegistration:o.stateRegistration,municipalRegistration:o.municipalRegistration,
        taxRegime:o.taxRegime,environment:o.environment,
        enabled:o.enabled==='on',productionConfirmed:o.productionConfirmed==='on',
        requestId:newCommandId()
      }});
      toast('Configuração fiscal salva. Documentos de homologação não têm validade fiscal.');
      await refreshCurrentPage();
    });
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
    (doc.fiscal_number?'<p><strong>Número/série:</strong> '+esc(doc.fiscal_number)+' / '+esc(doc.fiscal_series||'—')+'</p>':'')+
    (['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(doc.status)?'<button id="downloadFiscalXml" class="btn">Baixar XML</button>':'')+
    (doc.last_error?'<p class="error">'+esc(doc.last_error)+'</p>':'')+
    '<h3>Eventos</h3><div class="list">'+(rows||'<div class="empty">Nenhum evento.</div>')+'</div>');
  if($('#downloadFiscalXml'))$('#downloadFiscalXml').onclick=async()=>{
    try{
      const xml=await api('/api/fiscal/'+id+'/xml',{raw:true});
      const blob=new Blob([xml],{type:'application/xml;charset=utf-8'});
      const href=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=href;link.download=doc.kind+'-'+id+'.xml';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(href),1000);
    }catch(error){toast(error.message,true)}
  };
}
