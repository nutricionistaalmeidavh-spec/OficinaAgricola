// Interface fiscal: o rascunho NÃO é uma nota autorizada.
// Somente o servidor pode criar snapshots; o renderer nunca grava livros canônicos.
function fiscalSnapshot(doc){try{return JSON.parse(doc.snapshot_json||'{}')}catch{return {}}}
function fiscalOriginTitle(doc){
 const number=fiscalSnapshot(doc).originNumber;
 const name=doc.origin_type==='OS'?'OS':'Venda';
 return number!=null?name+' #'+String(number):name+' vinculada';
}
function fiscalDisplayTitle(doc){
 const kind=doc.kind==='NFE'?'NF-e':'NFS-e';
 if(doc.fiscal_number)return kind+' nº '+doc.fiscal_number+(doc.fiscal_series?' · série '+doc.fiscal_series:'');
 return kind+' · '+(doc.status==='RASCUNHO'?'Rascunho':String(doc.status||'Em processamento').replaceAll('_',' '));
}

async function renderFiscal({cursor=null,loaded=[]}={}){
  pageTitle('Fiscal','DOCUMENTOS E CONCILIAÇÃO');
  const [page,settings]=await Promise.all([api('/api/fiscal/page?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),api('/api/fiscal/settings')]);const docs=loaded.concat(page.items);
  const cards=docs.map(d=>{
    const origin=d.origin_type==='OS'?'OS':'Venda';
    const actions=d.status==='RASCUNHO'&&settings.enabled
      ? '<button class="btn sm" data-fiscal-submit="'+d.id+'">Transmitir</button>'
      : d.status==='INDETERMINADO'
        ? '<button class="btn sm" data-fiscal-check="'+d.id+'">Consultar situação</button>'
        : '';
    const isAuthorized=['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(d.status);
    const pdf=isAuthorized?'<button class="btn sm soft" data-fiscal-pdf="'+d.id+'">DANFE/PDF</button>':'';
    const cancel=isAuthorized&&state.user.role==='ADMIN'
      ?'<button class="btn sm soft" data-fiscal-cancel="'+d.id+'">Cancelar nota</button>':'';
    return '<div class="list-item"><div><strong>'+esc(fiscalDisplayTitle(d))+'</strong> · '+esc(fiscalOriginTitle(d))+
      '<br><small>'+esc(d.status)+' · '+money(d.amount_cents)+'</small></div><div class="action-row">'+
      '<button class="btn sm soft" data-fiscal-details="'+d.id+'">Histórico</button>'+pdf+cancel+actions+'</div></div>';
  }).join('');
  setContent('<div class="section-head fiscal-head"><div><h2>Documentos fiscais</h2>'+
    '<span class="muted">Rascunhos, notas e protocolos das ordens de serviço e vendas</span></div>'+
    '<div class="action-row">'+(state.user.role==='ADMIN'?'<button id="fiscalSettings" class="btn">Configuração fiscal</button><button id="fiscalCertificate" class="btn">Certificado A1</button><button id="fiscalDiagnose" class="btn">Testar SEFAZ</button>':'')+
    '<button id="fiscalNew" class="btn primary">+ Preparar documento</button></div></div>'+
    '<div class="card"><p><strong>Cadastro fiscal:</strong> '+(settings.enabled?'Cadastro completo':'Cadastro incompleto')+' · '+esc(settings.environment)+
    ' · CNPJ '+esc(settings.issuer_cnpj||'não informado')+'</p><p><strong>Emissão efetiva:</strong> exige certificado/credenciamento, classificação tributária e um emissor local validado. '+
    'Um rascunho ou um envio sem confirmação não substitui NF-e ou NFS-e autorizada.</p></div>'+
    '<div class="card"><div class="card-head"><h2>Registro fiscal</h2><small>'+docs.length+' documento(s) recente(s)</small></div>'+
    '<div class="list">'+(cards||'<div class="empty">Nenhum documento fiscal preparado.</div>')+'</div></div>');
  $('#fiscalNew').onclick=()=>fiscalDraftModal();
  if($('#fiscalSettings'))$('#fiscalSettings').onclick=()=>fiscalSettingsModal(settings);
  if($('#fiscalCertificate'))$('#fiscalCertificate').onclick=()=>fiscalCertificateModal();
  if($('#fiscalDiagnose'))$('#fiscalDiagnose').onclick=()=>fiscalRunDiagnosis();
  $$('[data-fiscal-details]').forEach(b=>b.onclick=()=>showFiscalHistory(Number(b.dataset.fiscalDetails)).catch(e=>toast(e.message,true)));
  $$('[data-fiscal-submit]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalSubmit),'submit'));
  $$('[data-fiscal-check]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalCheck),'reconcile'));
  $$('[data-fiscal-pdf]').forEach(button=>button.onclick=()=>downloadFiscalPdf(Number(button.dataset.fiscalPdf)).catch(e=>toast(e.message,true)));
  $$('[data-fiscal-cancel]').forEach(button=>button.onclick=()=>fiscalCancelModal(Number(button.dataset.fiscalCancel)));
   showPagedLoadMore({cursor:page.nextCursor,loaded:docs.length,total:page.total,onMore:()=>renderFiscal({cursor:page.nextCursor,loaded:docs})});
}

async function fiscalRunDiagnosis(){
  try{
    const result=await api('/api/fiscal/diagnose',{method:'POST',body:{}});
    const status=result?.nfe?.status||'INDETERMINADO';
    toast('SEFAZ NF-e: '+status+'. NFS-e requer validação municipal. Esta consulta não autoriza produção.');
  }catch(error){toast(error.message||'Falha no diagnóstico SEFAZ',true);}
}
async function fiscalCertificateModal(){
  let status;
  try{status=await api('/api/fiscal/onboarding');}
  catch(error){toast(error.message||'Configuração local indisponível',true);return;}
  const configured=status.certificate?.configured;
  const certificateText=configured
    ?'Certificado A1 local cadastrado. Identificador: '+esc(status.certificate.fingerprint||'')+
       '. Para substituir, selecione outro PFX.'
    :'Nenhum certificado cadastrado nesta empresa/unidade.';
  showModal('Certificado fiscal A1',
    '<form class="form-stack">'+
    '<p class="muted">'+certificateText+'</p>'+
    '<p class="muted">Selecione um arquivo .pfx ou .p12 emitido para sua empresa. Os dados são enviados somente ao backend local da unidade; a senha não é gravada no navegador nem no banco.</p>'+
    '<label>Certificado A1 (.pfx/.p12)<input name="certificateFile" type="file" accept=".pfx,.p12" required></label>'+
    '<label>Senha do certificado<input name="certificatePassword" type="password" autocomplete="off" maxlength="256"></label>'+
    '<p class="muted">Cartões e tokens A3 exigem suporte criptográfico e leitor compatíveis; este formulário é específico para A1.</p>'+
    '<button type="submit" class="btn primary">Instalar certificado e testar SEFAZ</button></form>',
    async form=>{
      const file=form.querySelector('[name="certificateFile"]')?.files?.[0];
      const password=form.querySelector('[name="certificatePassword"]')?.value||'';
      if(!file||file.size<1||file.size>3*1024*1024)
        throw Error('Escolha um PFX/P12 válido de até 3 MB');
      const encoded=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
        reader.onerror=()=>reject(Error('Não foi possível ler o certificado'));
        reader.readAsDataURL(file);
      });
      await api('/api/fiscal/certificate',{method:'POST',body:{pfxBase64:encoded,password}});
      form.querySelector('[name="certificatePassword"]').value='';
      toast('Certificado A1 armazenado localmente. Executando diagnóstico SEFAZ.');
      await fiscalRunDiagnosis();
      await refreshCurrentPage();
    });
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
    '<p class="muted">Ao concluir o cadastro, o ambiente de homologação é habilitado automaticamente. A transmissão exige certificado e ACBr configurados para esta empresa.</p>'+
    '<label><input type="checkbox" name="productionConfirmed"'+(current.production_confirmed?' checked':'')+'> Confirmo a configuração de produção (não equivale a credenciamento)</label>'+
    '<button class="btn primary" type="submit">Salvar configuração</button></form>',
    async form=>{
      const o=formObj(form);
      await api('/api/fiscal/settings',{method:'PATCH',body:{
        issuerCnpj:o.issuerCnpj,issuerUf:o.issuerUf,municipalityIbge:o.municipalityIbge,
        stateRegistration:o.stateRegistration,municipalRegistration:o.municipalRegistration,
        taxRegime:o.taxRegime,environment:o.environment,
        productionConfirmed:o.productionConfirmed==='on',
        requestId:newCommandId()
      }});
      toast('Configuração fiscal salva. Documentos de homologação não têm validade fiscal.');
      await refreshCurrentPage();
    });
}

function fiscalDraftModal(){
  const requestId=newCommandId();
  showModal('Preparar documento fiscal',
    '<form class="form-stack">'+
    '<p class="muted">Selecione uma OS com orçamento aprovado ou uma venda concluída. O rascunho não é uma nota autorizada.</p>'+
    '<label>Origem<select id="fiscalOriginType" name="originType"><option value="OS">Ordem de Serviço</option><option value="SALE">Venda de balcão</option></select></label>'+
    '<label>Buscar OS ou venda<input id="fiscalOriginSearch" type="search" autocomplete="off" placeholder="Número, cliente ou modelo" aria-controls="fiscalOriginOptions"></label>'+
    '<div id="fiscalOriginOptions" class="fiscal-origin-options" role="group" aria-label="Resultados da busca"></div>'+
    '<input type="hidden" name="originId" id="fiscalOriginId">'+
    '<div id="fiscalOriginSelection" class="fiscal-origin-selection" role="status" aria-live="polite">Nenhuma operação selecionada.</div>'+
    '<label>Documento<select id="fiscalKind" name="kind"><option value="NFE">NF-e — peças</option><option value="NFSE">NFS-e — mão de obra</option></select></label>'+
    '<div class="fiscal-draft-preview"><strong>Prévia do documento</strong><p id="fiscalDraftPreview" class="muted">Selecione uma operação para conferir a origem. Os itens e valores fiscais serão validados pelo servidor.</p></div>'+
    '<button id="fiscalDraftSubmit" class="btn primary" type="submit" disabled>Criar rascunho</button></form>',
    async form=>{
      const values=formObj(form);
      const originId=Number(values.originId);
      if(!Number.isSafeInteger(originId)||originId<1)throw new Error('Selecione uma OS ou venda na lista.');
      const doc=await api('/api/fiscal/drafts',{method:'POST',body:{
        originType:values.originType,originId,kind:values.kind,requestId
      }});
      if(!doc||doc.id==null)throw new Error('Criação do rascunho ainda não confirmada.');
      toast('Rascunho fiscal salvo. A nota ainda não foi autorizada.');
      await refreshCurrentPage();
    });
  const type=$('#fiscalOriginType'),search=$('#fiscalOriginSearch'),options=$('#fiscalOriginOptions');
  const selected=$('#fiscalOriginSelection'),hidden=$('#fiscalOriginId'),submit=$('#fiscalDraftSubmit');
  const preview=$('#fiscalDraftPreview'),kind=$('#fiscalKind');
  let sequence=0,timer=null,origin=null;

  const updatePreview=()=>{
    if(!origin){preview.textContent='Selecione uma operação para conferir a origem. Os itens e valores fiscais serão validados pelo servidor.';return}
    preview.textContent=(kind.value==='NFE'?'NF-e para peças':'NFS-e para mão de obra')+
      ' · '+origin.label+'. O valor fiscal será calculado pelo servidor somente com itens compatíveis.';
  };
  const clearSelection=()=>{
    origin=null;hidden.value='';submit.disabled=true;selected.textContent='Nenhuma operação selecionada.';updatePreview();
  };
  const findOrigins=async()=>{
    const ticket=++sequence,originType=type.value,term=search.value.trim();
    options.textContent='Buscando operações…';
    const rows=originType==='OS'
      ?(await api('/api/work-orders/page?limit=50&search='+encodeURIComponent(term))).items
      :await api('/api/sales?limit=50&status=CONCLUIDA&search='+encodeURIComponent(term));
    if(ticket!==sequence||!options.isConnected||type.value!==originType)return;
    const labels=rows.map(row=>{
      const label=originType==='OS'?
        'OS #'+row.os_number+' · '+(row.customer_name||'Cliente não identificado'):
        'Venda #'+row.sale_number+' · '+(row.customer_name||'Consumidor');
      const detail=originType==='OS'
        ?[row.machine_brand,row.machine_model,row.status].filter(Boolean).join(' · ')
        :money(row.total_cents)+' · '+row.status;
      return {...row,label,detail};
    });
    options.innerHTML=labels.length?labels.map(item=>
      '<button type="button" class="fiscal-origin-option" data-fiscal-origin="'+item.id+'">'+
      '<strong>'+esc(item.label)+'</strong><small>'+esc(item.detail)+'</small></button>'
    ).join(''):'<p class="muted">Nenhuma operação encontrada. Tente outro número ou nome.</p>';
    $$('[data-fiscal-origin]',options).forEach(button=>button.onclick=()=>{
      const item=labels.find(row=>String(row.id)===button.dataset.fiscalOrigin);
      if(!item)return;
      origin=item;hidden.value=String(item.id);
      selected.textContent='Selecionado: '+item.label+' · '+item.detail;
      submit.disabled=false;
      $$('[data-fiscal-origin]',options).forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      updatePreview();
    });
  };
  const findSafe=()=>findOrigins().catch(error=>{if(options.isConnected){
    options.textContent='Não foi possível carregar as operações: '+friendlyUiMessage(error.message)+'. Altere a busca para tentar novamente.';
  }});
  type.onchange=()=>{search.value='';++sequence;clearTimeout(timer);clearSelection();findSafe()};
  search.oninput=()=>{++sequence;clearTimeout(timer);clearSelection();timer=setTimeout(findSafe,220)};
  kind.onchange=updatePreview;
  void findSafe();
}

async function downloadFiscalPdf(id){
  const bytes=await api('/api/fiscal/'+id+'/pdf',{binary:true});
  if(bytes.length<8||bytes.length>6*1024*1024)
    throw new Error('Emissor não retornou PDF fiscal válido');
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='ArtiSys-Oficina-NF-'+id+'.pdf';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function fiscalCancelModal(id){
  showModal('Cancelar nota fiscal',
    '<form class="form-stack">'+
    '<p class="muted">Operação fiscal irreversível. O cancelamento depende da confirmação da SEFAZ ou prefeitura; falhas exigem consulta, nunca reenvio automático.</p>'+
    '<label>Justificativa (15 a 255 caracteres)<textarea name="reason" minlength="15" maxlength="255" required rows="3" placeholder="Descreva o motivo real do cancelamento"></textarea></label>'+
    '<button class="btn primary" type="submit">Solicitar cancelamento fiscal</button></form>',
    async form=>{
      const values=formObj(form);
      const reason=String(values.reason||'').trim();
      if(reason.length<15||reason.length>255)throw new Error('Informe uma justificativa de 15 a 255 caracteres.');
      const doc=await api('/api/fiscal/'+id+'/cancel',{method:'POST',
        body:{reason,requestId:newCommandId()}});
      toast(doc.status==='CANCELADA'?'Cancelamento confirmado pelo fisco.':
        'Cancelamento sem confirmação: use Consultar situação; não solicite novamente.',doc.status!=='CANCELADA');
      await refreshCurrentPage();
    });
}

const fiscalBusy=new Set();
async function fiscalAction(id,action){
  const key=action+':'+id;
  if(fiscalBusy.has(key))return;
  fiscalBusy.add(key);
  const selector=action==='submit'?'[data-fiscal-submit="'+id+'"]':'[data-fiscal-check="'+id+'"]';
  const button=$(selector);
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=action==='submit'?'Transmitindo…':'Consultando…'}
  try{
    await api('/api/fiscal/'+id+'/'+action,{method:'POST',body:{requestId:newCommandId()}});
    const doc=await api('/api/fiscal/'+id);
    await refreshCurrentPage();
    if(['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(doc.status))
      toast('Documento fiscal autorizado'+(doc.status==='AUTORIZADA_HOMOLOGACAO'?' em homologação.':'.'));
    else if(doc.status==='INDETERMINADO')
      toast('Transmissão sem conclusão confirmada. Consulte a situação fiscal antes de outra tentativa.',true);
    else
      toast('Situação fiscal atualizada: '+String(doc.status).replaceAll('_',' ')+'.');
  }catch(error){
    toast(error?.pending
      ?'Operação aguardando confirmação local. Não retransmita às cegas; revise as pendências.'
      :'Não foi possível confirmar a ação fiscal: '+error.message,true);
    await refreshCurrentPage().catch(()=>{});
  }finally{
    fiscalBusy.delete(key);
    if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');button.textContent=action==='submit'?'Transmitir':'Consultar situação'}
  }
}

async function showFiscalHistory(id){
  const [doc,events]=await Promise.all([api('/api/fiscal/'+id),api('/api/fiscal/'+id+'/events')]);
  const rows=events.map(e=>'<div class="list-item"><div><strong>'+esc(e.event_type)+'</strong><br><small>'+dt(e.created_at)+'</small></div></div>').join('');
  showModal(fiscalDisplayTitle(doc),
    '<div class="detail-grid"><div class="detail-block"><h3>Status</h3>'+esc(doc.status)+'</div>'+
    '<div class="detail-block"><h3>Total</h3>'+money(doc.amount_cents)+'</div></div>'+
    '<p><strong>Origem:</strong> '+esc(fiscalOriginTitle(doc))+'</p>'+
    (doc.access_key?'<p><strong>Chave:</strong> '+esc(doc.access_key)+'</p>':'')+
    (doc.protocol?'<p><strong>Protocolo:</strong> '+esc(doc.protocol)+'</p>':'')+
    (doc.fiscal_number?'<p><strong>Número/série:</strong> '+esc(doc.fiscal_number)+' / '+esc(doc.fiscal_series||'—')+'</p>':'')+
    (['AUTORIZADA','AUTORIZADA_HOMOLOGACAO','CANCELADA'].includes(doc.status)?'<button id="downloadFiscalXml" class="btn">Baixar XML original</button>':'')+
    (['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(doc.status)?'<button id="downloadFiscalPdf" class="btn">Baixar DANFE/DANFSe</button>':'')+
    (doc.last_error?'<p class="error">Não foi possível concluir a transmissão. Consulte a configuração fiscal e o suporte.</p>':'')+
    '<h3>Eventos</h3><div class="list">'+(rows||'<div class="empty">Nenhum evento.</div>')+'</div>');
  if($('#downloadFiscalPdf'))$('#downloadFiscalPdf').onclick=()=>downloadFiscalPdf(id).catch(e=>toast(e.message,true));
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
