// Primeiro acesso: projeção somente-leitura do estado canônico de cada unidade.
// Nenhuma etapa de homologação concede autorização de produção.
(function(){
  'use strict';
  const KEY='oficina:first-access-dismissed:v1:';
  const safeText=value=>typeof value==='string'?value.trim():'';
  const array=value=>Array.isArray(value)?value:[];
  const available=value=>Boolean(value)&&typeof value==='object'&&!value.error;
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
    const fiscalProduction=fiscalTestEligible&&fiscal?.productionReady===true;
    const fiscalHomologationVerified=fiscal?.authorizationVerified===true;
    const fiscalModels=fiscal?.models&&typeof fiscal.models==='object'?fiscal.models:{};
    const operationReady=db&&companyReady;
    return {
      unitId:unitKey(),db,companyReady,operationsConfigured,
      servicesCount:array(services).length,techniciansCount:array(technicians).length,
      fiscalRegistration,cert,provider,fiscalTestEligible,fiscalProduction,
      fiscalHomologationVerified,fiscalModels,operationReady,
      fiscalState:fiscalProduction?'PRODUCAO_APTA_POR_MODELO':
        fiscalHomologationVerified?'HOMOLOGACAO_VERIFICADA':
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
  // A lista visível é editorial: nunca é usada para autorizar emissão.
  // Os indicadores fiscais vêm do backend da unidade, não do navegador.
  function customerSteps(status){
    const fiscalDetail=status.fiscalProduction
      ?'Pelo menos um tipo de nota está habilitado'
      :status.fiscalHomologationVerified
        ?'Testes concluídos para alguns tipos de nota'
        :status.fiscalTestEligible?'Configuração em andamento'
        :status.fiscalRegistration?'Continue quando precisar emitir notas'
        :'Configure quando precisar emitir notas';
    return [
      {id:'system',title:'Sistema instalado',
        detail:status.db?'Tudo pronto para começar':'Aguardando conexão com o sistema',
        state:status.db?'done':'pending',action:null},
      {id:'company',title:'Dados da oficina',
        detail:status.companyReady?'Cadastro concluído':'Informe nome, documento e endereço',
        state:status.companyReady?'done':'pending',action:'company'},
      {id:'team',title:'Equipe e serviços',
        detail:status.operationsConfigured?'Cadastros concluídos':'Pode fazer depois',
        state:status.operationsConfigured?'done':'optional',action:'services'},
      {id:'fiscal',title:'Emissão de notas fiscais',
        detail:fiscalDetail,
        state:status.fiscalProduction?'done':
          (status.fiscalRegistration?'progress':'optional'),action:'fiscal'}
    ];
  }
  function customerProgress(status){
    const steps=customerSteps(status);
    const completed=steps.filter(step=>step.state==='done').length;
    return {completed,total:steps.length,percentage:Math.round(100*completed/steps.length)};
  }
  function actionButton(action,text,primary=false){
    return '<button type="button" class="btn first-access-button'+(primary?' primary':'')+
      '" data-first-access-action="'+action+'">'+esc(text)+'</button>';
  }
  function heading(status){
    const progress=customerProgress(status);
    return '<div class="first-access-heading">'+
      '<div class="first-access-heading-copy"><h2>Prepare sua oficina</h2>'+
      '<p>Configure o essencial para começar a trabalhar</p></div>'+
      '<span class="first-access-count">'+progress.completed+' de '+progress.total+'</span></div>'+
      '<div class="first-access-progress" role="progressbar" aria-label="Etapas concluídas"'+
      ' aria-valuemin="0" aria-valuemax="'+progress.total+
      '" aria-valuenow="'+progress.completed+'"><span style="width:'+progress.percentage+'%"></span></div>';
  }
  function stepMarkup(step){
    const stateLabel={done:'Concluído',pending:'Pendente',optional:'Opcional',progress:'Em andamento'};
    const text='<span class="first-access-step-icon" aria-hidden="true">'+
      (step.state==='done'?'✓':step.state==='progress'?'…':'○')+'</span>'+
      '<span class="first-access-step-copy"><strong>'+esc(step.title)+'</strong>'+
      '<small>'+esc(step.detail)+'</small></span>'+
      '<span class="first-access-step-state">'+esc(stateLabel[step.state])+'</span>'+
      (step.action?'<span class="first-access-chevron" aria-hidden="true">›</span>':'');
    return step.action
      ?'<button type="button" class="first-access-step first-access-action" data-state="'+
        step.state+'" data-first-access-action="'+step.action+'">'+text+'</button>'
      :'<div class="first-access-step" data-state="'+step.state+'">'+text+'</div>';
  }
  function stepsMarkup(status){
    return '<div class="first-access-steps" aria-label="Etapas de configuração">'+
      customerSteps(status).map(stepMarkup).join('')+'</div>';
  }
  function readyNotice(status){
    return status.operationReady?
      '<div class="first-access-ready" role="status">'+
      '<span class="first-access-ready-icon" aria-hidden="true">✓</span>'+
      '<span><strong>Sua oficina já pode funcionar</strong>'+
      '<small>A emissão de notas pode ser configurada separadamente.</small></span></div>':
      '<div class="first-access-pending" role="status">'+
      '<span class="first-access-ready-icon" aria-hidden="true">i</span>'+
      '<span><strong>Falta completar os dados da oficina</strong>'+
      '<small>Conclua o cadastro para começar a usar o sistema.</small></span></div>';
  }
  async function renderBanner(){
    if(!state.user||state.user.role!=='ADMIN'||state.page!=='dashboard')return;
    const host=document.querySelector('#content');
    if(!host)return;
    const previous=host.querySelector('#firstAccessBanner');
    if(previous)previous.remove();
    const status=await readStatus();
    if(state.page!=='dashboard'||!state.user||!host.isConnected)return;
    const dismissed=readDismissed();
    const node=document.createElement('section');
    node.id='firstAccessBanner';
    node.className='card first-access-card'+(dismissed?' first-access-card-compact':'');
    node.setAttribute('aria-label','Preparação da oficina');
    const warning=status.unavailable?'<p class="first-access-warning" role="alert">'+
      'Alguns dados não puderam ser verificados. Você pode tentar novamente ao abrir o checklist.</p>':'';
    node.innerHTML=dismissed
      ?'<div class="first-access-compact-copy"><strong>Preparação da oficina</strong>'+
        '<small>Veja ou atualize as configurações quando precisar.</small></div>'+
        actionButton('open','Ver checklist')
      :heading(status)+warning+stepsMarkup(status)+readyNotice(status)+
        '<div class="first-access-footer">'+
        actionButton('open','Ver todas as opções')+
        (status.operationReady?actionButton('dismiss','Começar a trabalhar',true):'')+
        '</div>';
    host.prepend(node);
    bindActions(node);
  }
  function bindActions(root){
    if(!root)return;
    root.querySelectorAll('[data-first-access-action]').forEach(button=>{
      button.onclick=async()=>{
        const action=button.dataset.firstAccessAction;
        if(action==='dismiss'){
          setDismissed(true);
          if(!document.querySelector('#modal')?.classList.contains('hidden'))closeModal();
          await renderBanner();
          return;
        }
        if(action==='open'){
          setDismissed(false);
          await openWizard();
          return;
        }
        try{
          const leaveModal=()=>{
            if(!document.querySelector('#modal')?.classList.contains('hidden'))closeModal();
          };
          if(action==='company'){leaveModal();await navigate('settings');return;}
          if(action==='services'){leaveModal();await navigate('services');return;}
          if(action==='technicians'){leaveModal();await navigate('technicians');return;}
          if(action==='users'){leaveModal();await navigate('settings');return;}
          if(action==='cash'){leaveModal();await navigate('sales');return;}
          if(action==='fiscal'){leaveModal();await navigate('fiscal');return;}
          if(action==='fiscal-settings'){
            const settings=await api('/api/fiscal/settings');
            fiscalSettingsModal(settings);
            return;
          }
          if(action==='a1'){await fiscalCertificateA1Modal();return;}
          if(action==='a3'){await fiscalCertificateA3Modal();return;}
          if(action==='diagnose'){
            button.disabled=true;
            button.setAttribute('aria-busy','true');
            button.textContent='Verificando…';
            const current=await readStatus();
            const lines=[
              'Cadastro da oficina: '+(current.companyReady?'concluído':'pendente'),
              'Dados fiscais: '+(current.fiscalRegistration?'preenchidos':'pendentes'),
              'Certificado digital: '+(current.cert?'configurado':'pendente')
            ];
            let sefaz='não testada';
            if(current.fiscalTestEligible){
              try{
                const response=await api('/api/fiscal/diagnose',{method:'POST',body:{}});
                sefaz=response?.nfe?.status==='ONLINE'?'online':
                  String(response?.nfe?.status||'não confirmada');
              }catch(error){sefaz='falha na consulta';}
            }
            lines.push('Serviço de notas: '+sefaz);
            lines.push('Este teste não autoriza a emissão de notas em produção.');
            const host=document.querySelector('#firstAccessDiagnostics');
            if(host)host.textContent=lines.join(' · ');
            toast('Verificação concluída. Confira o resultado abaixo.',sefaz!=='online');
            return;
          }
        }catch(error){
          toast(error.message||'Não foi possível abrir a configuração',true);
        }finally{
          if(action==='diagnose'){
            button.disabled=false;button.removeAttribute('aria-busy');
            button.textContent='Testar conexão';
          }
        }
      };
    });
  }
  function fiscalModelsMarkup(status){
    const models=status.fiscalModels;
    const entries=[['NFE','NF-e'],['NFCE','NFC-e'],['NFSE','NFS-e']];
    return '<div class="first-access-fiscal-models" aria-label="Situação dos tipos de nota">'+
      entries.map(([kind,title])=>{
        const model=models[kind];
        const detail=model?.productionReady?'Habilitada para tentar emitir':
          model?.homologationVerified?'Testes concluídos; produção pendente':
          'Ainda não habilitada';
        return '<div class="first-access-fiscal-model">'+
          '<strong>'+title+'</strong><span>'+esc(detail)+'</span></div>';
      }).join('')+'</div>';
  }
  async function openWizard(cached){
    if(!state.user||state.user.role!=='ADMIN')return;
    const s=cached||await readStatus();
    const warning=s.unavailable?'<p class="first-access-warning" role="alert">'+
      'Não foi possível consultar todos os dados. Etapas sem confirmação ficam pendentes.</p>':'';
    showModal('Prepare sua oficina',
      '<section class="first-access-panel" data-onboarding-unit="'+esc(s.unitId)+'">'+
      heading(s)+warning+stepsMarkup(s)+readyNotice(s)+
      '<div class="first-access-shortcuts"><h3>Atalhos de configuração</h3>'+
      '<div class="first-access-shortcut-actions">'+
      actionButton('company','Dados da oficina')+
      actionButton('services','Serviços')+
      actionButton('technicians','Equipe')+
      actionButton('users','Usuários')+
      actionButton('cash','Vendas e caixa')+'</div></div>'+
      '<details class="first-access-fiscal-options"><summary>'+
      '<span>Configurar emissão de notas</span><span aria-hidden="true">⌄</span></summary>'+
      '<div class="first-access-fiscal-options-body">'+
      '<p>Cada tipo de nota tem sua própria verificação. O teste de conexão não libera emissão em produção.</p>'+
      fiscalModelsMarkup(s)+
      '<div class="first-access-shortcut-actions">'+
      actionButton('fiscal','Abrir notas fiscais')+
      actionButton('fiscal-settings','Dados fiscais')+
      actionButton('a1','Certificado A1')+
      actionButton('a3','Certificado A3')+
      actionButton('diagnose','Testar conexão')+'</div>'+
      '<p class="first-access-diagnostics" id="firstAccessDiagnostics" role="status" aria-live="polite"></p>'+
      '</div></details>'+
      '<div class="first-access-footer">'+
      (s.operationReady?actionButton('dismiss','Começar a trabalhar',true):
        actionButton('company','Completar dados da oficina',true))+
      '</div></section>');
    bindActions(document.querySelector('#modalBody'));
  }
  window.OficinaFirstAccess={
    evaluate,readStatus,customerSteps,customerProgress,renderBanner,openWizard
  };
  // Nenhum documento, credencial, CNPJ ou resultado fiscal é gravado no navegador.
})();
