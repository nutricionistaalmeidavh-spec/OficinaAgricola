// Primeiro acesso: projeção somente-leitura do estado canônico de cada unidade.
// Nenhuma etapa de homologação concede autorização de produção.
(function(){
  'use strict';
  const KEY='oficina:first-access-dismissed:v1:';
  const safeText=value=>typeof value==='string'?value.trim():'';
  const array=value=>Array.isArray(value)?value:[];
  const available=value=>value&&typeof value==='object'&&!value.error;
  const unitKey=()=>String(window.OficinaTenant?.getUnitId?.()||'default');
  const preferenceKey=()=>KEY+String(window.OficinaTenant?.getUnitId?.()||'default')+
    ':'+String(state.user?.id||'admin');
  const readDismissed=()=>{try{return localStorage.getItem(preferenceKey())==='yes';}catch{return false;}};
  const setDismissed=flag=>{try{
    if(flag)localStorage.setItem(preferenceKey(),'yes');
    else localStorage.removeItem(preferenceKey());
  }catch{/* A preferência não é um estado canônico. */}};
  function evaluate({health=null,company=null,services=null,technicians=null,fiscal=null,settings=null}={}){
    const db=health?.ok===true&&health?.operationalApiReady===true;
    const companyReady=available(company)&&safeText(company.name).length>=2&&
      safeText(company.document).replace(/\D/g,'').length>=11&&
      safeText(company.address).length>=5&&
      ['MISTA','AUTOMOTIVA','AGRICOLA'].includes(company.service_profile);
    const operationsConfigured=array(services).length>0&&array(technicians).length>0;
    const fiscalRegistration=fiscal?.companyConfigured===true;
    const cert=fiscal?.certificate?.configured===true;
    const provider=fiscal?.providerReady===true;
    const fiscalTestEligible=fiscalRegistration&&cert&&provider;
    const fiscalProduction=fiscalTestEligible&&fiscal?.authorizationVerified===true&&
      fiscal?.taxProfileVerified===true&&settings?.environment==='PRODUCAO'&&
      settings?.production_confirmed===true;
    const operationReady=db&&companyReady;
    return {
      unitId:unitKey(),db,companyReady,operationsConfigured,
      servicesCount:array(services).length,techniciansCount:array(technicians).length,
      fiscalRegistration,cert,provider,fiscalTestEligible,fiscalProduction,
      operationReady,
      fiscalState:fiscalProduction?'PRODUCAO_AUTORIZADA':
        fiscalTestEligible?'PREPARADO_PARA_HOMOLOGACAO':'CONFIGURACAO_PENDENTE',
      pendingCore:(!db?1:0)+(!companyReady?1:0),
      coreCompleted:Number(db)+Number(companyReady),
      coreTotal:2
    };
  }
  async function readStatus(){
    const paths=['/api/health','/api/company','/api/services','/api/technicians',
      '/api/fiscal/onboarding','/api/fiscal/settings'];
    const answers=await Promise.allSettled(paths.map(path=>api(path)));
    const values=answers.map(reply=>reply.status==='fulfilled'?reply.value:null);
    const status=evaluate(Object.fromEntries(
      ['health','company','services','technicians','fiscal','settings']
        .map((name,i)=>[name,values[i]])));
    return {...status,unavailable:answers.filter(reply=>reply.status==='rejected').length,
      fiscalDetails:values[4],fiscalSettings:values[5]};
  }
  const label=(okay,good,bad)=>okay?good:bad;
  function statuses(status){
    return [
      ['P0','Instalação e banco',status.db,'Verificar PostgreSQL e API local'],
      ['P1','Cadastro da oficina',status.companyReady,'Informar nome, documento, endereço e perfil'],
      ['P2','Equipe e serviços (opcional)',status.operationsConfigured,
        'Cadastrar serviços e técnicos; pode ser feito depois'],
      ['P3','Certificado e ambiente fiscal',status.fiscalTestEligible,
        'Completar cadastro fiscal, certificado A1/A3 e ACBr local'],
      ['P4','Diagnóstico e homologação',false,
        'Executar diagnóstico SEFAZ; autorização real requer testes com emitente credenciado'],
      ['P5','Liberação',status.operationReady,
        'Oficina operacional independente da liberação fiscal'],
      ['P6','Retomada',true,'Progresso calculado a partir dos cadastros existentes'],
      ['P7','QA de distribuição',false,
        'Validar instalação limpa Windows e CI antes de distribuir']
    ];
  }
  function actionButton(action,text){
    return '<button type="button" class="btn sm" data-first-access-action="'+action+'">'+text+'</button>';
  }
  async function renderBanner(){
    if(!state.user||state.user.role!=='ADMIN'||state.page!=='dashboard')return;
    const host=document.querySelector('#content');
    if(!host)return;
    const previous=host.querySelector('#firstAccessBanner');
    if(previous)previous.remove();
    const status=await readStatus();
    if(state.page!=='dashboard'||!state.user||!host.isConnected)return;
    const node=document.createElement('div');
    node.id='firstAccessBanner';
    node.className='card';
    node.setAttribute('role','region');
    node.setAttribute('aria-label','Configuração inicial da oficina');
    const dismissed=readDismissed();
    const summary=status.operationReady?'Oficina pronta para trabalhar':
      'Configuração essencial: '+status.coreCompleted+' de '+status.coreTotal+' etapas';
    const fiscalSummary=status.fiscalProduction?'Fiscal autorizado para produção':
      status.fiscalTestEligible?'Fiscal preparado para testes de homologação':
      'Fiscal ainda precisa de configuração';
    node.innerHTML='<div class="card-head"><div><h2>Primeiro acesso</h2>'+
      '<p class="muted">'+esc(summary)+' · '+esc(fiscalSummary)+'</p></div>'+
      actionButton('open',dismissed?'Reabrir checklist':'Continuar configuração')+'</div>'+
      (dismissed?'':'<p class="muted">O progresso é verificado no banco da unidade. '+
        'A oficina pode funcionar sem emissão fiscal; emissão em produção depende de autorização legal e técnica.</p>')+
      (!dismissed&&status.operationReady?actionButton('dismiss','Começar a trabalhar'):'');
    host.prepend(node);
    bindActions(node,status);
  }
  function bindActions(root,status){
    root.querySelectorAll('[data-first-access-action]').forEach(button=>{
      button.onclick=async()=>{
        const action=button.dataset.firstAccessAction;
        if(action==='dismiss'){setDismissed(true);if(!document.querySelector('#modal')?.classList.contains('hidden'))closeModal();await renderBanner();return;}
        if(action==='open'){setDismissed(false);await openWizard(status);return;}
        try{
          if(action==='company'){closeModal();await navigate('settings');return;}
          if(action==='services'){closeModal();await navigate('services');return;}
          if(action==='technicians'){closeModal();await navigate('technicians');return;}
          if(action==='users'){closeModal();await navigate('settings');return;}
          if(action==='cash'){closeModal();await navigate('sales');return;}
          if(action==='fiscal'){closeModal();await navigate('fiscal');return;}
          if(action==='fiscal-settings'){
            const settings=await api('/api/fiscal/settings');
            fiscalSettingsModal(settings);
            return;
          }
          if(action==='a1'){await fiscalCertificateA1Modal();return;}
          if(action==='a3'){await fiscalCertificateA3Modal();return;}
          if(action==='diagnose'){
            button.disabled=true;button.textContent='Testando…';
            const response=await api('/api/fiscal/diagnose',{method:'POST',body:{}});
            const result=response?.nfe?.status||'INDETERMINADO';
            const host=document.querySelector('#firstAccessDiagnostics');
            if(host)host.textContent='Resultado SEFAZ NF-e: '+result+
              '. Este diagnóstico não comprova emissão, não libera produção nem valida NFS-e municipal.';
            toast(result==='ONLINE'?'SEFAZ acessível; pendente emissão homologada real':
              'Diagnóstico: '+result,result!=='ONLINE');
            button.textContent='Repetir diagnóstico';button.disabled=false;
            return;
          }
        }catch(error){
          button.disabled=false;
          if(action==='diagnose')button.textContent='Repetir diagnóstico';
          toast(error.message||'Falha na configuração',true);
        }
      };
    });
  }
  async function openWizard(cached){
    if(!state.user||state.user.role!=='ADMIN')return;
    const s=cached||await readStatus();
    const steps=statuses(s);
    const items=steps.map(([id,title,ok,help])=>{
      const diagnostic=id==='P4';
      const status=diagnostic?'Verificação necessária':label(ok,'Concluído','Pendente');
      return '<div class="list-item" style="align-items:flex-start"><div><strong>'+
        esc(id+' — '+title)+'</strong><br><small>'+esc(status+' · '+help)+
        '</small></div></div>';
    }).join('');
    const canTest=s.fiscalTestEligible;
    const warning=s.unavailable?'<p class="error" role="alert">'+
      s.unavailable+' consulta(s) indisponível(is). Não considerar etapas sem resposta como concluídas.</p>':'';
    showModal('Preparar o ArtiSys Oficina',
      '<div class="form-stack" data-onboarding-unit="'+esc(s.unitId)+'">'+
      '<p><strong>'+esc(s.operationReady?'Oficina pronta':'Configuração operacional pendente')+'</strong> · '+
      esc(s.fiscalProduction?'Fiscal autorizado para produção':
        s.fiscalTestEligible?'Fiscal apto a iniciar testes de homologação':
        'Fiscal ainda não preparado para homologação')+'</p>'+
      warning+
      '<div class="list">'+items+'</div>'+
      '<p><strong>1. Dados da empresa</strong></p><div class="action-row">'+
      actionButton('company','Editar empresa')+actionButton('fiscal-settings','Dados fiscais')+'</div>'+
      '<p><strong>2. Operação (opcional)</strong></p><div class="action-row">'+
      actionButton('services','Serviços')+actionButton('technicians','Técnicos')+
      actionButton('users','Usuários')+actionButton('cash','Caixa e vendas')+'</div>'+
      '<p><strong>3. Certificado fiscal e testes</strong></p><div class="action-row">'+
      actionButton('a1','Instalar A1')+actionButton('a3','Selecionar A3')+
      actionButton('diagnose','Testar comunicação SEFAZ')+actionButton('fiscal','Abrir Fiscal')+'</div>'+
      '<p class="muted" id="firstAccessDiagnostics" role="status" aria-live="polite">'+
      (canTest?'Certificado e provedor configurados: execute a verificação real em homologação.':
        'Antes do diagnóstico, cadastre os dados fiscais e configure certificado e ACBr.')+'</p>'+
      '<p class="muted">Homologação e produção são independentes da operação da oficina. '+
      'Somente credenciamento, regras tributárias conferidas e autorização comprovada permitem emissão válida. '+
      'A confirmação administrativa isolada não é homologação.</p>'+
      (s.operationReady?actionButton('dismiss','Começar a trabalhar'):'')+
      '</div>');
    bindActions(document.querySelector('#modalBody'),s);
  }
  window.OficinaFirstAccess={evaluate,readStatus,renderBanner,openWizard};
  // Não persiste documento, credenciais, CNPJ nem resultados fiscais no navegador.
})();
