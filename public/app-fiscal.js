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
  const [page,settings,readinessReply]=await Promise.all([
    api('/api/fiscal/page?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),
    api('/api/fiscal/settings'),
    api('/api/fiscal/onboarding').catch(error=>({
      unavailable:true,models:{},reason:error?.message||'Consulta de prontidão indisponível'
    }))
  ]);
  // Compatibilidade: a ausência de leitura do gate nunca habilita produção.
  const readiness=readinessReply&&typeof readinessReply==='object'
    ?readinessReply:{unavailable:true,models:{}};
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
      '<button class="btn sm soft" data-fiscal-details="'+d.id+'">Histórico</button>'+revise+(d.status==='RASCUNHO'&&d.kind==='NFSE'&&fiscalSnapshot(d).nfseRoute?.channel==='NACIONAL'&&state.user.role==='ADMIN'?'<button class="btn sm soft" data-nfse-national-dps="'+d.id+'">DPS Nacional</button>':'')+(d.status==='RASCUNHO'&&d.kind!=='NFSE'?'<button class="btn sm soft" data-fiscal-tax-review="'+d.id+'">Revisar tributos</button>':'')+pdf+cancel+actions+'</div></div>';
  }).join('');
  const modelLabels={NFE:'NF-e',NFCE:'NFC-e',NFSE:'NFS-e'};
  // Etapas editoriais; a autorização continua exclusiva do backend por modelo.
  const modelsSummary=Object.entries(modelLabels).map(([kind,title])=>{
    const model=readiness.models?.[kind];
    const configured=settings.enabled===true;
    const verified=model?.homologationVerified===true;
    const released=model?.productionReady===true;
    const stage=(number,label,done,detail)=>'<li><strong>'+number+'. '+label+'</strong> — '+
      (done?'Concluído':esc(detail))+'</li>';
    return '<section class="card" aria-label="Etapas de emissão '+title+'">'+
      '<h3>'+title+'</h3><ol>'+
      stage(1,'Configurar dados fiscais',configured,'Preencha os dados da empresa e o certificado')+
      stage(2,'Testar em homologação',verified,model?.reason||'É necessária uma nota de teste autorizada')+
      stage(3,'Habilitar produção',released,verified?'Confirme os requisitos de produção':'Conclua a homologação primeiro')+
      '</ol><small class="muted">'+(released?'Pronta para tentar emitir; cada nota ainda será validada.':
        'A emissão em produção continua protegida até a validação do sistema.')+'</small></section>';
  }).join('');
  setContent('<div class="section-head fiscal-head"><div><h2>Documentos fiscais</h2>'+
    '<span class="muted">Rascunhos, notas e protocolos das ordens de serviço e vendas</span></div>'+
    '<div class="action-row">'+(state.user.role==='ADMIN'?'<button id="fiscalSettings" class="btn">Configuração fiscal</button><button id="fiscalTaxProfiles" class="btn">Perfis tributários</button><button id="fiscalCertA1" class="btn">Certificado A1</button><button id="fiscalCertA3" class="btn">Token A3</button><button id="fiscalDiagnose" class="btn">Testar SEFAZ</button>':'')+
    '<button id="fiscalNew" class="btn primary">+ Preparar documento</button></div></div>'+
    '<div class="card"><p><strong>Cadastro fiscal:</strong> '+(settings.enabled?'Cadastro concluído':'Aguardando cadastro fiscal')+' · '+esc(settings.environment)+
    ' · CNPJ '+esc(settings.issuer_cnpj||'não informado')+'</p>'+
    '<div class="fiscal-model-steps">'+modelsSummary+'</div>'+
    '<p><strong>Emissão efetiva:</strong> exige certificado/credenciamento, classificação tributária e um emissor local validado. '+
    'Um rascunho ou um envio sem confirmação não substitui NF-e, NFC-e ou NFS-e autorizada.</p></div>'+
    '<div class="card"><div class="card-head"><h2>Registro fiscal</h2><small>'+docs.length+' documento(s) recente(s)</small></div>'+
    '<div class="list">'+(cards||'<div class="empty">Nenhum documento fiscal preparado.</div>')+'</div></div>');
  $('#fiscalNew').onclick=()=>fiscalDraftModal();
  if($('#fiscalSettings'))$('#fiscalSettings').onclick=()=>fiscalSettingsModal(settings);
  if($('#fiscalTaxProfiles'))$('#fiscalTaxProfiles').onclick=()=>fiscalTaxProfilesModal();
  $$('[data-fiscal-tax-review]').forEach(button=>button.onclick=()=>fiscalTaxReviewModal(Number(button.dataset.fiscalTaxReview)).catch(e=>toast(e.message,true)));
  if($('#fiscalCertA1'))$('#fiscalCertA1').onclick=()=>fiscalCertificateA1Modal();
  if($('#fiscalCertA3'))$('#fiscalCertA3').onclick=()=>fiscalCertificateA3Modal();
  if($('#fiscalDiagnose'))$('#fiscalDiagnose').onclick=()=>fiscalRunDiagnosis();
  $$('[data-nfse-national-dps]').forEach(b=>b.onclick=()=>fiscalNationalDpsModal(Number(b.dataset.nfseNationalDps)).catch(e=>toast(e.message,true)));
  $$('[data-nfse-competence]').forEach(b=>b.onclick=()=>fiscalReviseCompetence(Number(b.dataset.nfseCompetence)).catch(e=>toast(e.message,true)));
  $$('[data-fiscal-details]').forEach(b=>b.onclick=()=>showFiscalHistory(Number(b.dataset.fiscalDetails)).catch(e=>toast(e.message,true)));
  $$('[data-fiscal-submit]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalSubmit),'submit'));
  $$('[data-fiscal-check]').forEach(b=>b.onclick=()=>fiscalAction(Number(b.dataset.fiscalCheck),'reconcile'));
  $$('[data-fiscal-pdf]').forEach(button=>button.onclick=()=>downloadFiscalPdf(Number(button.dataset.fiscalPdf)).catch(e=>toast(e.message,true)));
  $$('[data-fiscal-cancel]').forEach(button=>button.onclick=()=>fiscalCancelModal(Number(button.dataset.fiscalCancel)));
   showPagedLoadMore({cursor:page.nextCursor,loaded:docs.length,total:page.total,onMore:()=>renderFiscal({cursor:page.nextCursor,loaded:docs})});
}

async function fiscalTaxProfilesModal(){
  const [profiles,settings]=await Promise.all([
    api('/api/fiscal/tax/profiles'),api('/api/fiscal/settings')]);
  const isNormal=settings.tax_regime==='NORMAL';
  const rows=profiles.map(p=>'<div class="list-item"><div><strong>'+
    esc(p.name)+'</strong><br><small>'+esc(p.kind==='GOODS'
      ?'NCM '+p.ncm+' · CFOP '+p.cfop+' · '+p.icmsScheme+' '+p.icmsCode
      :'Serviço '+p.serviceListCode+' · município '+p.municipalityIbge)+
    '</small></div><button type="button" class="btn sm soft" data-tax-edit="'+esc(p.id)+'">Editar</button></div>').join('');
  showModal('Perfis tributários da empresa',
    '<div class="card"><strong>Perfis cadastrados</strong><div class="list">'+
    (rows||'<p class="muted">Nenhum perfil cadastrado nesta unidade.</p>')+'</div></div>'+
    '<form class="form-stack">'+
    '<input name="id" type="hidden">'+
    '<p class="muted">O responsável fiscal ou contador deve confirmar classificação e alíquotas. Não há determinação automática de impostos.</p>'+
    '<label>Tipo de regra<select id="taxKind" name="kind">'+
    '<option value="GOODS">Mercadorias — NF-e / NFC-e</option>'+
    '<option value="SERVICE">Serviços — NFS-e nacional/municipal</option></select></label>'+
    '<label>Nome do perfil<input name="name" maxlength="80" required placeholder="Ex.: Peças de manutenção"></label>'+
    '<div id="taxGoods" class="form-stack">'+
    '<div class="field-row"><label>NCM (8 dígitos)<input name="ncm" inputmode="numeric" maxlength="8"></label>'+
    '<label>CFOP (4 dígitos)<input name="cfop" inputmode="numeric" maxlength="4"></label></div>'+
    '<div class="field-row"><label>Origem ICMS (0–8)<input name="origin" maxlength="1" value="0"></label>'+
    '<label>Regime do ICMS<select name="icmsScheme"><option value="'+(isNormal?'CST':'CSOSN')+'">'+(isNormal?'CST':'CSOSN')+'</option></select></label></div>'+
    '<div class="field-row"><label>Código '+(isNormal?'CST':'CSOSN')+'<input name="icmsCode" maxlength="3" placeholder="'+(isNormal?'00, 40, 41 ou 50':'102, 103, 300 ou 400')+'"></label>'+
    '<label>Unidade<input name="unit" maxlength="6" value="UN"></label></div>'+
    '<div class="field-row"><label>CST PIS<input name="pisCst" maxlength="2" placeholder="49"></label>'+
    '<label>CST COFINS<input name="cofinsCst" maxlength="2" placeholder="49"></label></div>'+
    '<div class="field-row"><label>CEST (se aplicável)<input name="cest" maxlength="7"></label>'+
    '<label>Benefício fiscal (se aplicável)<input name="benefitCode" maxlength="20"></label></div></div>'+
    '<div id="taxService" class="form-stack" hidden>'+
    '<p class="muted">O código e a alíquota do ISS dependem do município. Salvar este perfil não significa que a prefeitura já esteja integrada.</p>'+
    '<label>Município IBGE<input name="municipalityIbge" inputmode="numeric" maxlength="7" value="'+esc(settings.municipality_ibge||'')+'"></label>'+
    '<div class="field-row"><label>Item da lista LC 116 (ex.: 14.01)<input name="serviceListCode" maxlength="5"></label>'+
    '<label>Código de serviço municipal<input name="municipalServiceCode" maxlength="25"></label></div>'+
    '<div class="field-row"><label>Código nacional cTribNac (6 dígitos)<input name="nationalServiceCode" inputmode="numeric" maxlength="6" placeholder="Confirmar com contador"></label>'+
    '<label>NBS (9 dígitos, se aplicável)<input name="nbsCode" inputmode="numeric" maxlength="9"></label></div>'+
    '<div class="field-row"><label>CNAE (7 dígitos)<input name="cnae" maxlength="7"></label>'+
    '<label>Alíquota ISS (%)<input name="issRate" placeholder="3.00" maxlength="7"></label></div>'+
    '<label><input type="checkbox" name="withheld"> ISS retido pelo tomador</label></div>'+
    '<button type="submit" class="btn primary">Salvar perfil tributário</button></form>',
    async form=>{
      const x=formObj(form);
      const profile={...(x.id?{id:x.id}:{}),kind:x.kind,name:x.name,...(x.kind==='GOODS'?{
        ncm:x.ncm,cfop:x.cfop,origin:x.origin,icmsScheme:x.icmsScheme,
        icmsCode:x.icmsCode,pisCst:x.pisCst,cofinsCst:x.cofinsCst,unit:x.unit,
        cest:x.cest,benefitCode:x.benefitCode
      }:{
        municipalityIbge:x.municipalityIbge,serviceListCode:x.serviceListCode,
        municipalServiceCode:x.municipalServiceCode,cnae:x.cnae,
        nationalServiceCode:x.nationalServiceCode,nbsCode:x.nbsCode,
        issRate:x.issRate,withheld:x.withheld==='on'
      })};
      await api('/api/fiscal/tax/profiles',{method:'POST',body:{profile}});
      toast('Perfil tributário salvo nesta unidade. Confirme os dados com seu contador.');
      await refreshCurrentPage();
    });
  const kind=$('#taxKind'),goods=$('#taxGoods'),service=$('#taxService');
  const update=()=>{goods.hidden=kind.value!=='GOODS';service.hidden=kind.value!=='SERVICE';goods.style.display=goods.hidden?'none':'flex';service.style.display=service.hidden?'none':'flex'};
  kind.onchange=update;
  update();
  const form=$('#modalBody form');
  $('[data-tax-edit]').forEach(button=>button.onclick=()=>{
    const selected=profiles.find(p=>p.id===button.dataset.taxEdit);
    if(!selected||!form)return;
    for(const [key,value] of Object.entries(selected)){
      const field=form.elements.namedItem(key);
      if(!field)continue;
      if(field.type==='checkbox')field.checked=value===true;
      else field.value=String(value??'');
    }
    kind.value=selected.kind;update();
    form.querySelector('[name="name"]')?.focus();
  });
}
async function fiscalTaxReviewModal(id){
  const [doc,profiles,settings]=await Promise.all([
    api('/api/fiscal/'+id),api('/api/fiscal/tax/profiles'),api('/api/fiscal/settings')]);
  if(doc.status!=='RASCUNHO')throw Error('Somente rascunhos fiscais permitem revisão');
  if(!['NFE','NFCE'].includes(doc.kind))
    throw Error('NFS-e depende de revisão municipal específica');
  const choices=profiles.filter(p=>p.kind==='GOODS');
  if(!choices.length){
    showModal('Revisão tributária','<p>Cadastre primeiro um perfil de mercadoria em <strong>Perfis tributários</strong> e confirme a classificação com o contador.</p>');
    return;
  }
  const snap=fiscalSnapshot(doc),lines=snap.lines||[];
  const profileOptions=choices.map(p=>'<option value="'+esc(p.id)+'">'+
    esc(p.name)+' · NCM '+esc(p.ncm)+' · CFOP '+esc(p.cfop)+'</option>').join('');
  const addressForm=(prefix,title,values={})=>'<fieldset class="form-stack">'+
    '<legend>'+title+'</legend>'+
    '<label>'+(prefix==='issuer'?'Razão social':'Nome do destinatário')+
    '<input name="'+prefix+'Name" value="'+esc(values.name||'')+'" maxlength="60" required></label>'+
    '<div class="field-row"><label>Rua<input name="'+prefix+'Street" maxlength="60" required></label>'+
    '<label>Número<input name="'+prefix+'Number" maxlength="20" required></label></div>'+
    '<div class="field-row"><label>Bairro<input name="'+prefix+'District" maxlength="60" required></label>'+
    '<label>Cidade<input name="'+prefix+'City" maxlength="60" required></label></div>'+
    '<div class="field-row"><label>CEP (8 dígitos)<input name="'+prefix+'Zip" maxlength="8" inputmode="numeric" required></label>'+
    (prefix==='customer'?'<label>UF<input name="customerUf" maxlength="2" required></label>':'')+'</div>'+
    (prefix==='customer'?'<label>Município IBGE<input name="customerIbge" maxlength="7" required></label>':'')+
    '</fieldset>';
  const taxValues=(i,prefix)=>'<div class="field-row">'+
    '<label>Base '+prefix+' (R$)<input name="item'+i+prefix+'Base" placeholder="0.00" inputmode="decimal"></label>'+
    '<label>Alíquota '+prefix+' (%)<input name="item'+i+prefix+'Rate" placeholder="0.00"></label>'+
    '<label>Valor '+prefix+' (R$)<input name="item'+i+prefix+'Amount" placeholder="0.00"></label></div>';
  const ibsField=(i,key,label)=>'<label>'+label+'<input name="item'+i+key+'" inputmode="decimal"></label>';
  const ibsValues=i=>'<details><summary>IBS/CBS da reforma tributária, quando aplicável</summary>'+
    '<p class="muted">Preencha somente com classificação fiscal conferida. Benefícios e diferimento exigem cClassTrib oficial.</p>'+
    ibsField(i,'IbsCst','CST IBS/CBS (3 dígitos)')+
    ibsField(i,'IbsClass','cClassTrib (6 dígitos)')+
    ibsField(i,'IbsBase','Base IBS/CBS (R$)')+
    ibsField(i,'IbsUfRate','Alíquota IBS UF (%)')+
    ibsField(i,'IbsMunRate','Alíquota IBS Município (%)')+
    ibsField(i,'IbsCbsRate','Alíquota CBS (%)')+
    '<details><summary>Redução de alíquota, se autorizada</summary>'+
    ibsField(i,'IbsReductionUf','Redução IBS UF (%)')+
    ibsField(i,'IbsReductionMun','Redução IBS Município (%)')+
    ibsField(i,'IbsReductionCbs','Redução CBS (%)')+'</details>'+
    '<details><summary>Diferimento, se autorizado</summary>'+
    ibsField(i,'IbsDeferralUf','Diferimento IBS UF (%)')+
    ibsField(i,'IbsDeferralMun','Diferimento IBS Município (%)')+
    ibsField(i,'IbsDeferralCbs','Diferimento CBS (%)')+'</details></details>';
  const itemRows=lines.map((line,i)=>'<fieldset class="form-stack"><legend>Item '+(i+1)+
    ' · '+esc(line.description||'')+' · '+money(line.totalCents)+'</legend>'+
    '<label>Classificação aprovada<select name="item'+i+'Profile">'+profileOptions+'</select></label>'+
    '<details><summary>Valores tributários se o CST exigir base e alíquota</summary>'+
    '<p class="muted">Para ICMS CST 00 e PIS/COFINS CST 01/02, informe base, alíquota e valor calculados pelo responsável fiscal. Não inferimos impostos.</p>'+
    taxValues(i,'Icms')+taxValues(i,'Pis')+taxValues(i,'Cofins')+'</details>'+ibsValues(i)+'</fieldset>').join('');
  showModal('Revisar '+(doc.kind==='NFCE'?'NFC-e':'NF-e')+' #'+id,
    '<form class="form-stack">'+
    '<p class="muted">Revisão vinculada ao rascunho original. Não autoriza transmissão nem substitui a conferência do contador.</p>'+
    '<div class="field-row"><label>Série<input name="series" maxlength="3" required></label>'+
    '<label>Número fiscal<input name="number" maxlength="9" required></label></div>'+
    '<label>Natureza da operação<input name="nature" maxlength="60" required></label>'+
    (doc.kind==='NFCE'?'<label>Meio de pagamento (tPag, 2 dígitos)<input name="paymentCode" maxlength="2" required></label>':'')+
    addressForm('issuer','Endereço completo do emitente')+
    (doc.kind==='NFE'||snap.customer?.document?addressForm('customer','Endereço do destinatário',{name:snap.customer?.name||''}):'')+
    '<h3>Tributação dos itens</h3>'+itemRows+
    '<button class="btn primary" type="submit">Validar e salvar revisão</button></form>',
    async form=>{
      const o=formObj(form);
      const addr=prefix=>({
        name:o[prefix+'Name'],legalName:o[prefix+'Name'],
        street:o[prefix+'Street'],number:o[prefix+'Number'],
        district:o[prefix+'District'],city:o[prefix+'City'],zip:o[prefix+'Zip'],
        ...(prefix==='customer'?{uf:o.customerUf,municipalityIbge:o.customerIbge}:{})
      });
      const taxes=(i,name)=>({
        base:o['item'+i+name+'Base'],rate:o['item'+i+name+'Rate'],
        amount:o['item'+i+name+'Amount']});
      const typedIbs=i=>{
        const names=['Cst','Class','Base','UfRate','MunRate','CbsRate',
          'ReductionUf','ReductionMun','ReductionCbs',
          'DeferralUf','DeferralMun','DeferralCbs'];
        const selected=Object.fromEntries(names.map(key=>[key,String(o['item'+i+'Ibs'+key]||'').trim().replace(',','.')]));
        if(!Object.values(selected).some(Boolean))return null;
        return {cst:selected.Cst,cClassTrib:selected.Class,base:selected.Base,
          ufRate:selected.UfRate,munRate:selected.MunRate,cbsRate:selected.CbsRate,
          reductionUf:selected.ReductionUf,reductionMun:selected.ReductionMun,reductionCbs:selected.ReductionCbs,
          deferralUf:selected.DeferralUf,deferralMun:selected.DeferralMun,deferralCbs:selected.DeferralCbs};
      };
      const body={company:addr('issuer'),
        customer:(doc.kind==='NFE'||snap.customer?.document)?addr('customer'):null,
        issuance:{number:o.number,series:o.series,nature:o.nature,
          ...(doc.kind==='NFCE'?{paymentCode:o.paymentCode}:{})},
        items:lines.map((_,i)=>({profileId:o['item'+i+'Profile'],
          icms:taxes(i,'Icms'),pis:taxes(i,'Pis'),cofins:taxes(i,'Cofins'),
          ibscbs:typedIbs(i)}))};
      await api('/api/fiscal/'+id+'/tax-review',{method:'POST',body});
      toast('Revisão salva e validada contra o documento fiscal. A nota ainda não foi transmitida.');
      await refreshCurrentPage();
    });
}
async function fiscalNationalDpsAutoModal(documentId){
  const [profiles,document,settings]=await Promise.all([
    api('/api/fiscal/tax/profiles'),api('/api/fiscal/'+documentId),api('/api/fiscal/settings')]);
  const available=profiles.filter(p=>p.kind==='SERVICE'&&p.nationalServiceCode&&p.municipalityIbge===settings.municipality_ibge);
  const snap=fiscalSnapshot(document),client=snap.customer||{},v=x=>esc(String(x||''));
  showModal('Gerar DPS automaticamente',
    '<form class="form-stack"><p class="muted">Use o perfil confirmado pelo contador. O Oficina assina a DPS com o A1 cadastrado, sem XML manual. Somente homologação até a conclusão fiscal.</p>'+
    '<label>Perfil de serviço<select name="profileId" required><option value="">Selecione</option>'+available.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' / '+esc(p.nationalServiceCode)+'</option>').join('')+'</select></label>'+
    '<div class="field-row"><label>Série da DPS<input name="series" inputmode="numeric" maxlength="5" required></label><label>Número sequencial<input name="number" inputmode="numeric" value="'+v(document.id)+'" maxlength="15" required></label></div>'+
    '<label>Tomador<input name="customerName" value="'+v(client.name)+'" required maxlength="120"></label>'+
    '<label>CPF/CNPJ<input name="customerDocument" value="'+v(client.document)+'" required></label>'+
    '<div class="field-row"><label>Município IBGE<input name="customerMunicipality" maxlength="7" required></label><label>CEP<input name="customerZip" maxlength="8" required></label></div>'+
    '<div class="field-row"><label>Logradouro<input name="customerStreet" required></label><label>Número<input name="customerNumber" required></label></div>'+
    '<label>Bairro<input name="customerDistrict" required></label>'+
    '<div class="field-row"><label>Opção Simples<select name="opSimpNac" required><option value="">Selecione</option><option value="1">Não optante</option><option value="2">MEI</option><option value="3">Simples</option></select></label>'+
    '<label>Regime especial<select name="regEspTrib" required><option value="">Selecione</option><option value="0">Nenhum</option><option value="1">Regime 1</option><option value="2">Regime 2</option></select></label></div>'+
    '<label>Regime de apuração SN (se aplicável)<input name="regApTribSN" maxlength="1"></label>'+
    '<div class="field-row"><label>Tributação ISS<select name="tribISSQN"><option value="1">Tributável</option></select></label><label>Retenção ISS<select name="tpRetISSQN"><option value="1">Não retido</option><option value="2">Retido</option></select></label></div>'+
    '<label>CST PIS/COFINS<input name="cstPisCofins" maxlength="2" required></label>'+
    '<label>Carga tributária Simples (%)<input name="percentSimples"></label>'+
    '<div class="field-row"><label>Carga federal (%)<input name="percentFederal"></label><label>Carga estadual (%)<input name="percentState"></label></div>'+
    '<label>Carga municipal (%)<input name="percentMunicipal"></label>'+
    '<button class="btn primary" type="submit" '+(!available.length?'disabled':'')+'>Gerar e assinar DPS</button></form>',
    async form=>{
      const x=formObj(form);
      await api('/api/fiscal/'+documentId+'/nfse/prepare',{method:'POST',body:{
        profileId:x.profileId,requestId:newCommandId(),
        customer:{name:x.customerName,document:x.customerDocument,municipalityIbge:x.customerMunicipality,
          zip:x.customerZip,street:x.customerStreet,number:x.customerNumber,district:x.customerDistrict},
        issuance:{series:x.series,number:x.number,opSimpNac:x.opSimpNac,regEspTrib:x.regEspTrib,
          regApTribSN:x.regApTribSN,tribISSQN:x.tribISSQN,tpRetISSQN:x.tpRetISSQN,
          cstPisCofins:x.cstPisCofins,percentSimples:x.percentSimples,
          percentFederal:x.percentFederal,percentState:x.percentState,percentMunicipal:x.percentMunicipal}
      }});
      toast('DPS assinada e pronta para transmitir. Nenhuma nota enviada ainda.');
      await refreshCurrentPage();
    });
}
async function fiscalNationalDpsModal(documentId){
  const state=await api('/api/fiscal/'+documentId+'/nfse/dps');
  if(state.enabled&&!state.prepared)return fiscalNationalDpsAutoModal(documentId);
  if(!state.enabled){
    showModal('DPS Nacional — preparação',
      '<p class="muted">Esta empresa ainda usa o emissor ACBr. Para transmitir diretamente pela API oficial, o administrador da instalação precisa ativar o canal nacional direto, mantendo a emissão municipal separada.</p>'+
      '<p>Não é necessário contratar uma API de terceiros.</p>');
    return;
  }
  showModal('Preparar DPS assinada · NFS-e Nacional',
    '<form class="form-stack">'+
    '<p class="muted">'+(state.prepared
      ?'DPS já vinculada a este rascunho: '+esc(state.idDps||'')+'. Ela não pode ser substituída.'
      :'Selecione uma DPS em XML já assinada digitalmente pelo contribuinte e validada conforme o leiaute nacional. O Oficina verificará CNPJ, município, competência, número e valor antes da transmissão.')+'</p>'+
    '<p class="muted">O arquivo é armazenado somente na pasta privada da unidade. Não envie PFX, senha ou PIN nesta etapa.</p>'+
    (state.prepared?'':'<label>XML da DPS assinada<input type="file" name="signedDps" accept=".xml,text/xml,application/xml" required></label>'+
      '<button type="submit" class="btn primary">Validar e anexar DPS</button>')+'</form>',
    async form=>{
      if(state.prepared)return;
      const file=form.querySelector('[name="signedDps"]')?.files?.[0];
      if(!file||!file.size||file.size>512*1024)throw Error('Selecione XML assinado de até 512 KB');
      const signedDpsXml=await file.text();
      if(!signedDpsXml.includes('<DPS')&&!signedDpsXml.includes(':DPS'))
        throw Error('Arquivo não contém DPS no padrão nacional');
      await api('/api/fiscal/'+documentId+'/nfse/dps',{
        method:'POST',body:{signedDpsXml,requestId:newCommandId()}});
      toast('DPS Nacional preparada. A nota ainda não foi transmitida.');
      await refreshCurrentPage();
    });
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
