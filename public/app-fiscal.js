// Interface fiscal: o rascunho NÃO é uma nota autorizada.
// Somente o servidor pode criar snapshots; o renderer nunca grava livros canônicos.
function fiscalSnapshot(doc){try{return JSON.parse(doc.snapshot_json||'{}')}catch{return {}}}
function fiscalOriginTitle(doc){
 const number=fiscalSnapshot(doc).originNumber;
 const name=doc.origin_type==='OS'?'OS':'Venda';
 return number!=null?name+' #'+String(number):name+' vinculada';
}
function fiscalDisplayTitle(doc){
 const kind=doc.kind==='NFE'?'NF-e':doc.kind==='NFCE'?'NFC-e':'NFS-e';
 if(doc.fiscal_number)return kind+' nº '+doc.fiscal_number+(doc.fiscal_series?' · série '+doc.fiscal_series:'');
 return kind+' · '+(doc.status==='RASCUNHO'?'Rascunho':String(doc.status||'Em processamento').replaceAll('_',' '));
}

async function renderFiscal({cursor=null,loaded=[]}={}){
  pageTitle('Fiscal','DOCUMENTOS E CONCILIAÇÃO');
  const [page,settings,readiness]=await Promise.all([
    api('/api/fiscal/page?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),
    api('/api/fiscal/settings'),api('/api/fiscal/onboarding')
  ]);
  const docs=loaded.concat(page.items);
  const cards=docs.map(d=>{
    const origin=d.origin_type==='OS'?'OS':'Venda';
    const needsCompetence=d.kind==='NFSE'&&!fiscalSnapshot(d).nfseRoute;
    const productionPending=settings.environment==='PRODUCAO'&&
      readiness.models?.[d.kind]?.productionReady!==true;
    const actions=d.status==='RASCUNHO'&&settings.enabled&&!needsCompetence
      ?productionPending
        ? '<small class="muted" role="status">'+esc(readiness.models?.[d.kind]?.reason||
            'Emissão em produção ainda não habilitada')+'</small>'
        :'<button class="btn sm" data-fiscal-submit="'+d.id+'">Transmitir</button>'
      : d.status==='INDETERMINADO'
        ? '<button class="btn sm" data-fiscal-check="'+d.id+'">Consultar situação</button>'
        : '';
    const revise=d.kind==='NFSE'&&d.status==='RASCUNHO'
      ?'<button class="btn sm soft" data-nfse-competence="'+d.id+'">Ajustar competência</button>':'';
    const isAuthorized=['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(d.status);
    const pdf=isAuthorized?'<button class="btn sm soft" data-fiscal-pdf="'+d.id+'">DANFE/PDF</button>':'';
    const cancel=isAuthorized&&state.user.role==='ADMIN'
      ?'<button class="btn sm soft" data-fiscal-cancel="'+d.id+'">Cancelar nota</button>':'';
    const nfse=fiscalSnapshot(d).nfseRoute;
    const routeText=d.kind==='NFSE'?(nfse?.channel&&nfse?.competenceDate?
      '<br><small>Competência '+esc(nfse.competenceDate)+' · '+esc(nfse.channel==='NACIONAL'?'Emissor Nacional':'Emissor Municipal')+'</small>':
      '<br><small>NFS-e antiga: rota e competência precisam de revisão antes de emitir</small>'):'';
    return '<div class="list-item"><div><strong>'+esc(fiscalDisplayTitle(d))+'</strong> · '+esc(fiscalOriginTitle(d))+
      '<br><small>'+esc(d.status)+' · '+money(d.amount_cents)+'</small>'+routeText+'</div><div class="action-row">'+
      '<button class="btn sm soft" data-fiscal-details="'+d.id+'">Histórico</button>'+revise+pdf+cancel+actions+'</div></div>';
  }).join('');
  const modelLabels={NFE:'NF-e',NFCE:'NFC-e',NFSE:'NFS-e'};
  const modelsSummary=Object.entries(modelLabels).map(([kind,title])=>{
    const model=readiness.models?.[kind];
    return title+': '+(model?.productionReady?'produção tecnicamente habilitada':
      model?.homologationVerified?'homologação comprovada, produção pendente':
        model?.reason||'verificação pendente');
  }).join(' · ');
  setContent('<div class="section-head fiscal-head"><div><h2>Documentos fiscais</h2>'+
    '<span class="muted">Rascunhos, notas e protocolos das ordens de serviço e vendas</span></div>'+
    '<div class="action-row">'+(state.user.role==='ADMIN'?'<button id="fiscalSettings" class="btn">Configuração fiscal</button><button id="fiscalCertA1" class="btn">Certificado A1</button><button id="fiscalCertA3" class="btn">Token A3</button><button id="fiscalDiagnose" class="btn">Testar SEFAZ</button>':'')+
    '<button id="fiscalNew" class="btn primary">+ Preparar documento</button></div></div>'+
    '<div class="card"><p><strong>Cadastro fiscal:</strong> '+(settings.enabled?'Cadastro concluído':'Aguardando cadastro fiscal')+' · '+esc(settings.environment)+
    ' · CNPJ '+esc(settings.issuer_cnpj||'não informado')+'</p>'+
    '<p><strong>Situação por modelo:</strong> '+esc(modelsSummary)+'</p>'+
    '<p><strong>Emissão efetiva:</strong> exige certificado/credenciamento, classificação tributária e um emissor local validado. '+
    'Um rascunho ou um envio sem confirmação não substitui NF-e, NFC-e ou NFS-e autorizada.</p></div>'+
    '<div class="card"><div class="card-head"><h2>Registro fiscal</h2><small>'+docs.length+' documento(s) recente(s)</small></div>'+
    '<div class="list">'+(cards||'<div class="empty">Nenhum documento fiscal preparado.</div>')+'</div></div>');
  $('#fiscalNew').onclick=()=>fiscalDraftModal();
  if($('#fiscalSettings'))$('#fiscalSettings').onclick=()=>fiscalSettingsModal(settings);
  if($('#fiscalCertA1'))$('#fiscalCertA1').onclick=()=>fiscalCertificateA1Modal();
  if($('#fiscalCertA3'))$('#fiscalCertA3').onclick=()=>fiscalCertificateA3Modal();
  if($('#fiscalDiagnose'))$('#fiscalDiagnose').onclick=()=>fiscalRunDiagnosis();
  $$('[data-nfse-competence]').forEach(b=>b.onclick=()=>fiscalReviseCompetence(Number(b.dataset.nfseCompetence)).catch(e=>toast(e.message,true)));
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
    toast('SEFAZ NF-e: '+status+'. NFS-e exige homologação municipal. Diagnóstico não libera produção.',status!=='ONLINE');
  }catch(error){toast(error.message||'Falha no diagnóstico SEFAZ',true)}
}
async function fiscalCertificateA1Modal(){
  let current;
  try{current=await api('/api/fiscal/onboarding')}
  catch(error){toast(error.message,true);return}
  const active=current.certificate?.configured
    ?'Atual: '+esc(current.certificate.certificateType||'Certificado instalado')
    :'Nenhum certificado selecionado para esta empresa.';
  showModal('Certificado A1 — arquivo PFX/P12',
    '<form class="form-stack">'+
    '<p class="muted">'+active+'</p>'+
    '<p class="muted">O certificado e sua senha ficam somente no armazenamento local privado da unidade; nenhum dado é salvo no navegador ou PostgreSQL.</p>'+
    '<label>Arquivo PFX/P12<input name="certificateFile" type="file" accept=".pfx,.p12" required></label>'+
    '<label>Senha do certificado<input name="certificatePassword" type="password" autocomplete="off" maxlength="256"></label>'+
    '<button type="submit" class="btn primary">Instalar A1</button></form>',
    async form=>{
      const file=form.querySelector('[name="certificateFile"]')?.files?.[0];
      const password=form.querySelector('[name="certificatePassword"]')?.value||'';
      if(!file||file.size<1||file.size>3*1024*1024)
        throw Error('Selecione um PFX/P12 de até 3 MB');
      const encoded=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
        reader.onerror=()=>reject(Error('Não foi possível ler o certificado'));
        reader.readAsDataURL(file);
      });
      await api('/api/fiscal/certificate',{method:'POST',body:{pfxBase64:encoded,password}});
      form.querySelector('[name="certificatePassword"]').value='';
      toast('Certificado A1 instalado no armazenamento local da unidade.');
      await refreshCurrentPage();
    });
}
async function fiscalCertificateA3Modal(){
  try{
    const status=await api('/api/fiscal/onboarding');
    const certificates=await api('/api/fiscal/certificates');
    const options=Array.isArray(certificates)?certificates:[];
    const current=status.certificate?.certificateType==='A3'
      ?'Certificado A3 selecionado: final '+esc(status.certificate.serialSuffix||'')
      :'Nenhum token A3 selecionado.';
    if(!options.length){
      showModal('Cartão ou token A3',
        '<p class="muted">'+current+'</p>'+
        '<p>Nenhum certificado válido do CNPJ desta empresa foi localizado no Windows. Conecte o token/cartão, instale o driver da certificadora no Windows e abra novamente esta tela.</p>'+
        '<p>O PIN é solicitado pelo driver do dispositivo, não pelo Oficina.</p>');
      return;
    }
    showModal('Selecionar certificado A3',
      '<form class="form-stack">'+
      '<p class="muted">'+current+'</p>'+
      '<p class="muted">Selecione o certificado da sua empresa instalado no Windows. O cartão/token continua conectado ao computador; o PIN é solicitado pelo driver no momento da operação.</p>'+
      '<label>Certificado do Windows<select name="serial" required>'+
      options.map(cert=>'<option value="'+esc(cert.serial)+'">'+
        esc(cert.name||'Certificado')+' · '+esc(cert.serial.slice(-8))+
        ' · validade '+esc(cert.validUntil||'')+'</option>').join('')+
      '</select></label>'+
      '<button type="submit" class="btn primary">Usar este certificado A3</button></form>',
      async form=>{
        const serial=form.querySelector('[name="serial"]')?.value||'';
        const selected=await api('/api/fiscal/certificate/a3',{method:'POST',body:{serial}});
        if(selected.certificateType!=='A3')throw Error('Seleção A3 não confirmada');
        toast('Certificado A3 associado à empresa. Execute o diagnóstico SEFAZ antes da primeira nota.');
        await refreshCurrentPage();
      });
  }catch(error){toast(error.message||'Não foi possível identificar certificado A3',true)}
}
function fiscalSettingsModal(current){
  const selected=(value,expected)=>value===expected?' selected':'';
  const safe=value=>esc(value||'');
  const prDDD44=Array.isArray(globalThis.PR_DDD44_MUNICIPIOS)?globalThis.PR_DDD44_MUNICIPIOS:[];
  showModal('Configuração fiscal da empresa',
    '<form class="form-stack">'+
    '<p class="muted">Somente dados cadastrais. Nunca informe certificado digital, senha ou chave privada nesta tela.</p>'+
    '<label>CNPJ emissor<input name="issuerCnpj" value="'+safe(current.issuer_cnpj)+'" inputmode="numeric" maxlength="18"></label>'+
    '<div class="field-row"><label>UF<select id="fiscalIssuerUf" name="issuerUf"><option value="">Selecione</option>'+['SP','PR','MG','RJ','SC','RS'].map(uf=>'<option value="'+uf+'"'+selected(current.issuer_uf,uf)+'>'+uf+'</option>').join('')+'</select></label>'+
    '<label>Município IBGE<input id="fiscalMunicipalityIbge" name="municipalityIbge" inputmode="numeric" maxlength="7" value="'+safe(current.municipality_ibge)+'"></label></div>'+
    '<label id="fiscalDDD44Lookup" hidden>Municípios do DDD 44 (PR) — seleção opcional'+
    '<select id="fiscalDDD44City"><option value="">Escolha a cidade para preencher o IBGE</option>'+
    prDDD44.map(city=>'<option value="'+city.ibge+'"'+selected(String(current.municipality_ibge),city.ibge)+'>'+esc(city.name)+'</option>').join('')+
    '</select><small>Para cidades fora do DDD 44, digite o código IBGE acima.</small></label>'+
    '<div class="field-row"><label>Inscrição estadual<input name="stateRegistration" value="'+safe(current.state_registration)+'"></label>'+
    '<label>Inscrição municipal<input name="municipalRegistration" value="'+safe(current.municipal_registration)+'"></label></div>'+
    '<label>Regime tributário<select name="taxRegime">'+
    '<option value="">Selecione</option>'+
    ['MEI','SIMPLES','NORMAL'].map(s=>'<option value="'+s+'"'+selected(current.tax_regime,s)+'>'+s+'</option>').join('')+
    '</select></label>'+
    '<label>Ambiente<select name="environment">'+
    '<option value="HOMOLOGACAO"'+selected(current.environment,'HOMOLOGACAO')+'>Homologação (sem valor fiscal)</option>'+
    '<option value="PRODUCAO"'+selected(current.environment,'PRODUCAO')+'>Produção</option></select></label>'+
    '<p class="muted">A preparação e a homologação ficam disponíveis após o cadastro. Para NFC-e, configure CSC no ACBr local e credenciamento estadual. SC exige autorização e requisitos PAF-NFC-e; RS exige vinculação aos meios de pagamento quando aplicável.</p>'+
    '<label><input type="checkbox" name="productionConfirmed"'+(current.production_confirmed?' checked':'')+'> Confirmo a configuração de produção (não equivale a credenciamento)</label>'+
    '<button class="btn primary" type="submit">Salvar configuração</button></form>',
    async form=>{
      const o=formObj(form);
      await api('/api/fiscal/settings',{method:'PATCH',body:{
        issuerCnpj:o.issuerCnpj,issuerUf:o.issuerUf,municipalityIbge:o.municipalityIbge,
        stateRegistration:o.stateRegistration,municipalRegistration:o.municipalRegistration,
        taxRegime:o.taxRegime,environment:o.environment,
        enabled:true,productionConfirmed:o.productionConfirmed==='on',
        requestId:newCommandId()
      }});
      toast('Configuração fiscal salva. Documentos de homologação não têm validade fiscal.');
      await refreshCurrentPage();
    });
  const issuerUf=$('#fiscalIssuerUf'),ibge=$('#fiscalMunicipalityIbge');
  const lookup=$('#fiscalDDD44Lookup'),city=$('#fiscalDDD44City');
  const syncCity=()=>{
    lookup.hidden=issuerUf.value!=='PR';
    lookup.style.display=issuerUf.value==='PR'?'':'none';
    city.value=issuerUf.value==='PR'&&prDDD44.some(item=>item.ibge===ibge.value)?ibge.value:'';
  };
  issuerUf.onchange=syncCity;
  ibge.oninput=syncCity;
  city.onchange=()=>{if(city.value)ibge.value=city.value};
  syncCity();
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
    '<label>Documento<select id="fiscalKind" name="kind"><option value="NFE">NF-e — peças</option><option value="NFCE">NFC-e — venda ao consumidor</option><option value="NFSE">NFS-e — mão de obra</option></select></label>'+ 
    '<div id="fiscalNfseCompetence" hidden><label>Data de competência do serviço<input type="date" id="fiscalCompetenceDate" name="competenceDate"></label>'+
    '<p id="fiscalNfseRoute" class="muted" role="status" aria-live="polite">Informe a competência para verificar o emissor obrigatório.</p></div>'+
    '<div class="fiscal-draft-preview"><strong>Prévia do documento</strong><p id="fiscalDraftPreview" class="muted">Selecione uma operação para conferir a origem. Os itens e valores fiscais serão validados pelo servidor.</p></div>'+
    '<button id="fiscalDraftSubmit" class="btn primary" type="submit" disabled>Criar rascunho</button></form>',
    async form=>{
      const values=formObj(form);
      const originId=Number(values.originId);
      if(!Number.isSafeInteger(originId)||originId<1)throw new Error('Selecione uma OS ou venda na lista.');
      const doc=await api('/api/fiscal/drafts',{method:'POST',body:{
        originType:values.originType,originId,kind:values.kind,
        ...(values.kind==='NFSE'?{competenceDate:values.competenceDate}:{}),requestId
      }});
      if(!doc||doc.id==null)throw new Error('Criação do rascunho ainda não confirmada.');
      toast('Rascunho fiscal salvo. A nota ainda não foi autorizada.');
      await refreshCurrentPage();
    });
  const type=$('#fiscalOriginType'),search=$('#fiscalOriginSearch'),options=$('#fiscalOriginOptions');
  const selected=$('#fiscalOriginSelection'),hidden=$('#fiscalOriginId'),submit=$('#fiscalDraftSubmit');
  const preview=$('#fiscalDraftPreview'),kind=$('#fiscalKind');
  const competence=$('#fiscalCompetenceDate'),routeText=$('#fiscalNfseRoute'),competenceGroup=$('#fiscalNfseCompetence');
  let sequence=0,timer=null,origin=null,nfseSequence=0,nfseRoute=null;
  const updateSubmit=()=>{submit.disabled=!origin||(kind.value==='NFSE'&&!nfseRoute)};
  const updateNfseRoute=async()=>{
    const ticket=++nfseSequence;
    competenceGroup.hidden=kind.value!=='NFSE';
    competenceGroup.style.display=kind.value==='NFSE'?'':'none';
    nfseRoute=null;updateSubmit();
    if(kind.value!=='NFSE')return;
    if(!competence.value){routeText.textContent='Informe a competência do serviço para definir o canal fiscal.';return}
    routeText.textContent='Verificando o emissor conforme competência, município e regime…';
    try{
      const route=await api('/api/fiscal/nfse/route',{method:'POST',body:{competenceDate:competence.value}});
      if(ticket!==nfseSequence||!routeText.isConnected)return;
      nfseRoute=route.channel==='PENDENTE'?null:route.channel;
      routeText.textContent=(nfseRoute?'Canal definido: '+(nfseRoute==='NACIONAL'?'Emissor Nacional':'Emissor Municipal')+'. ':'Emissão ainda não preparada. ')+route.reason;
    }catch(error){
      if(ticket!==nfseSequence||!routeText.isConnected)return;
      routeText.textContent='Não foi possível definir o emissor: '+friendlyUiMessage(error.message);
    }
    updateSubmit();
  };

  const updatePreview=()=>{
    if(!origin){preview.textContent='Selecione uma operação para conferir a origem. Os itens e valores fiscais serão validados pelo servidor.';return}
    preview.textContent=(kind.value==='NFE'?'NF-e para peças':kind.value==='NFCE'?'NFC-e para consumidor final':'NFS-e para mão de obra')+
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
      updateSubmit();
      $$('[data-fiscal-origin]',options).forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      updatePreview();
    });
  };
  const findSafe=()=>findOrigins().catch(error=>{if(options.isConnected){
    options.textContent='Não foi possível carregar as operações: '+friendlyUiMessage(error.message)+'. Altere a busca para tentar novamente.';
  }});
  type.onchange=()=>{search.value='';++sequence;clearTimeout(timer);clearSelection();findSafe()};
  search.oninput=()=>{++sequence;clearTimeout(timer);clearSelection();timer=setTimeout(findSafe,220)};
  kind.onchange=()=>{updatePreview();void updateNfseRoute()};
  competence.onchange=()=>{void updateNfseRoute()};
  void updateNfseRoute();
  void findSafe();
}

async function fiscalReviseCompetence(id){
  const doc=await api('/api/fiscal/'+id);
  if(doc.kind!=='NFSE'||doc.status!=='RASCUNHO')throw new Error('Apenas rascunhos NFS-e permitem corrigir competência.');
  const current=fiscalSnapshot(doc).nfseRoute?.competenceDate||'';
  showModal('Ajustar competência da NFS-e',
    '<form class="form-stack"><p class="muted">O documento ainda não foi transmitido. A competência determina o emissor nacional ou municipal; alterar aqui preserva os itens e o histórico.</p>'+
    '<label>Data de competência<input id="nfseReviseDate" type="date" name="competenceDate" value="'+esc(current)+'" required></label>'+
    '<p id="nfseReviseResult" role="status" aria-live="polite" class="muted">Verificando o emissor…</p>'+
    '<button type="submit" class="btn primary" id="nfseReviseSubmit" disabled>Salvar competência</button></form>',
    async form=>{
      const competenceDate=formObj(form).competenceDate;
      await api('/api/fiscal/'+id+'/nfse/competence',{method:'POST',body:{competenceDate,requestId:newCommandId()}});
      toast('Competência e emissor do rascunho NFS-e atualizados. Nenhuma nota foi transmitida.');
      await refreshCurrentPage();
    });
  const input=$('#nfseReviseDate'),result=$('#nfseReviseResult'),submit=$('#nfseReviseSubmit');
  let sequence=0;
  const preview=async()=>{
    const ticket=++sequence;submit.disabled=true;
    if(!input.value){result.textContent='Informe uma competência para continuar.';return}
    result.textContent='Verificando o canal de NFS-e…';
    try{
      const route=await api('/api/fiscal/nfse/route',{method:'POST',body:{competenceDate:input.value}});
      if(ticket!==sequence||!result.isConnected)return;
      const ready=route.channel!=='PENDENTE';
      result.textContent=(ready?'Emissor '+(route.channel==='NACIONAL'?'Nacional':'Municipal')+'. ':'Configuração pendente. ')+route.reason;
      submit.disabled=!ready;
    }catch(error){if(ticket===sequence&&result.isConnected)
      result.textContent='Não foi possível verificar: '+friendlyUiMessage(error.message)}
  };
  input.onchange=()=>{void preview()};
  void preview();
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
