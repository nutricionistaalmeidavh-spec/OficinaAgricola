// Primeiro acesso por unidade: progresso canônico no PostgreSQL, não no navegador.
// Fiscal e produção permanecem independentes da liberação operacional.
const FIRST_RUN_DESTINATIONS=Object.freeze({
 company:'settings',services:'services',team:'technicians',
 cash:'sales',fiscal:'fiscal'
});
const FIRST_RUN_EXPLANATIONS=Object.freeze({
 company:'Informe o nome e o endereço da oficina. O CNPJ e o regime tributário serão usados na etapa fiscal.',
 services:'Cadastre os serviços mais comuns da oficina. Pode completar depois.',
 team:'Cadastre técnicos e usuários conforme a necessidade. Pode completar depois.',
 cash:'Abra seu primeiro caixa quando for realizar vendas. Pode completar depois.',
 printer:'Conecte e teste a impressora no computador. Confirme manualmente se funcionar.',
 fiscal:'Configure CNPJ, UF, município, regime e certificado A1/A3; homologação real é independente da operação.'
});
async function openInitialPage(){
 let page='dashboard';
 if(state.user?.role==='ADMIN'){
  try{
   const result=await api('/api/onboarding');
   if(!result.finished)page='onboarding';
  }catch(error){toast('Não foi possível consultar o primeiro acesso: '+error.message,true);}
 }
 await navigate(page);
}
async function renderOnboarding(){
 pageTitle('Primeiro acesso','CONFIGURAÇÃO DA OFICINA');
 const [status,health]=await Promise.all([
  api('/api/onboarding'),api('/api/health')
 ]);
 const statuses=status.steps.map(step=>{
  const complete=step.complete,skipped=step.skipped;
  const label=complete?'Concluído':skipped?'Para depois':'Pendente';
  const action=FIRST_RUN_DESTINATIONS[step.key];
  const button=action?'<button class="btn sm" type="button" data-first-go="'+step.key+'">'+
    (complete?'Revisar':'Configurar')+'</button>':'';
  const printer=step.key==='printer'&&!complete?
    '<button type="button" class="btn sm" data-first-confirm="printer">Impressora testada</button>':'';
  const optional=!step.required&&!complete?
    '<button type="button" class="btn sm soft" data-first-pref="'+step.key+'" data-first-action="'+
    (skipped?'resume':'skip')+'">'+(skipped?'Retomar':'Fazer depois')+'</button>':'';
  const text=FIRST_RUN_EXPLANATIONS[step.key]||'';
  return '<article class="first-run-step"><div class="first-run-step-body">'+
    '<span class="first-run-state">'+esc(label)+'</span>'+
    '<h3>'+esc(step.label)+(step.required?' <small>Obrigatório</small>':'')+'</h3>'+
    '<p>'+esc(text)+'</p></div><div class="first-run-step-actions">'+button+printer+optional+'</div></article>';
 }).join('');
 const fiscal=status.fiscal||{};
 const statusText=status.fiscalState==='HOMOLOGACAO'
   ?'Cadastro e certificado presentes. Homologação SEFAZ/NFS-e ainda não comprovada.'
   :'Pendente de dados fiscais, certificado ou credenciamento.';
 setContent('<div class="first-run-page">'+
  '<div class="card first-run-hero"><div class="first-run-heading"><div>'+
  '<small>INSTALAÇÃO · CADASTRO · OPERAÇÃO</small>'+
  '<h2>Prepare sua oficina para trabalhar</h2>'+
  '<p>Você só precisa concluir os dados da empresa para começar. As demais etapas podem ser feitas depois, inclusive o fiscal.</p>'+
  '</div><span class="first-run-count">'+status.progress+' de '+status.total+'</span></div>'+
  '<progress max="'+status.total+'" value="'+status.progress+'" aria-label="Progresso da configuração"></progress>'+
  '<p class="muted">Seu progresso fica salvo na unidade. Pode fechar e continuar depois.</p></div>'+
  '<div class="first-run-states">'+
  '<div class="card"><strong>Instalação</strong><p>'+esc(health.engine==='postgres'&&health.operationalApiReady?'PostgreSQL local conectado':'Verificar inicialização do PostgreSQL')+'</p></div>'+
  '<div class="card"><strong>Oficina</strong><p>'+esc(status.readyToWork?'Pronta para operar':'Aguardando dados da empresa')+'</p></div>'+
  '<div class="card"><strong>Fiscal</strong><p>'+esc(status.fiscalState==='HOMOLOGACAO'?'Em preparação/homologação':'Pendente (não bloqueia a oficina)')+'</p></div></div>'+
  '<div class="card"><div class="card-head"><h2>Etapas de configuração</h2><small>Somente o cadastro da empresa é obrigatório</small></div>'+
  '<div class="first-run-steps">'+statuses+'</div></div>'+
  '<div class="card first-run-check"><div><h2>Verificação da instalação</h2>'+
  '<p>Verifica conexão com o banco e dados da oficina. Testes SEFAZ devem ser realizados com o emitente credenciado; nunca habilitam produção automaticamente.</p>'+
  '<p id="firstRunDiagnostic" class="muted" role="status">'+esc(statusText)+'</p></div>'+
  '<button id="firstRunCheck" class="btn sm" type="button">Executar diagnóstico local</button></div>'+
  '<div class="card first-run-finish"><div><strong>'+esc(status.readyToWork?'Sua oficina já pode trabalhar':'Conclua os dados da empresa')+'</strong>'+
  '<p class="muted">NF-e, NFC-e e NFS-e mantêm configuração, testes e autorizações próprios.</p></div>'+
  '<div class="action-row">'+
  (status.finished?'<button id="firstRunReopen" type="button" class="btn sm">Reabrir configuração</button>':'')+
  '<button id="firstRunFinish" class="btn primary" type="button"'+(status.readyToWork?'':' disabled')+'>Começar a trabalhar</button></div></div></div>');
 $$('[data-first-go]').forEach(btn=>btn.onclick=()=>navigate(FIRST_RUN_DESTINATIONS[btn.dataset.firstGo]));
 $$('[data-first-pref]').forEach(btn=>btn.onclick=async()=>{
  btn.disabled=true;
  try{
   await api('/api/onboarding',{method:'PATCH',body:{action:btn.dataset.firstAction,step:btn.dataset.firstPref}});
   await refreshCurrentPage();
  }catch(error){toast(error.message,true);btn.disabled=false;}
 });
 $$('[data-first-confirm]').forEach(btn=>btn.onclick=async()=>{
  btn.disabled=true;
  try{
   await api('/api/onboarding',{method:'PATCH',body:{action:'confirm',step:'printer'}});
   await refreshCurrentPage();
  }catch(error){toast(error.message,true);btn.disabled=false;}
 });
 const check=$('#firstRunCheck');
 check.onclick=async()=>{
  check.disabled=true;
  const notice=$('#firstRunDiagnostic');notice.textContent='Verificando…';
  try{
   const result=await api('/api/onboarding/diagnostics');
   notice.textContent=(result.database.ok?'PostgreSQL: conectado. ':'Banco: falhou. ')+
     (result.company.ok?'Empresa: configurada. ':'Empresa: pendente. ')+
     'Fiscal: não autorizado automaticamente para produção.';
  }catch(error){notice.textContent='Diagnóstico falhou: '+friendlyUiMessage(error.message);}
  finally{check.disabled=false;}
 };
 const finish=$('#firstRunFinish');
 finish.onclick=async()=>{
  finish.disabled=true;
  try{
   await api('/api/onboarding',{method:'PATCH',body:{action:'finish'}});
   await navigate('dashboard');
  }catch(error){toast(error.message,true);finish.disabled=false;}
 };
 const reopen=$('#firstRunReopen');
 if(reopen)reopen.onclick=async()=>{
  reopen.disabled=true;
  try{await api('/api/onboarding',{method:'PATCH',body:{action:'reopen'}});await refreshCurrentPage();}
  catch(error){toast(error.message,true);reopen.disabled=false;}
 };
}
