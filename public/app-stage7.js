const OA_PIPELINE=[
  {key:'entrada',label:'Entrada',statuses:['ENTRADA']},
  {key:'diagnostico',label:'Diagnóstico',statuses:['DIAGNOSTICO','ORCAMENTO']},
  {key:'aprovacao',label:'Aguard. aprovação',statuses:['AGUARDANDO_APROVACAO','APROVADA']},
  {key:'servico',label:'Em serviço',statuses:['EM_SERVICO']},
  {key:'pronta',label:'Pronta',statuses:['PRONTA']},
];

function oaKpi(label,value,kind=''){
  return `<div class="oa-kpi-card ${kind}"><div class="oa-kpi-label"><span>${esc(label)}</span><i class="oa-kpi-dot"></i></div><strong>${value}</strong></div>`;
}

function oaOrderCard(order){
  const machine=[order.machine_brand,order.machine_model].filter(Boolean).join(' ')||'Máquina não informada';
  return `<button type="button" class="oa-order-mini" data-oa-os="${order.id}"><strong>OS #${order.os_number} · ${esc(order.customer_name)}</strong><p>${esc(machine)}<br>${esc(order.problem_reported||'Sem descrição')}</p>${badge(order.status)}</button>`;
}

async function renderDashboard(){
  pageTitle('Visão Geral','OPERAÇÃO EM TEMPO REAL');
  const [d,orders]=await Promise.all([api('/api/dashboard'),api('/api/work-orders')]);
  const f=d.finance||null;
  const pipeline=OA_PIPELINE.map(column=>{
    const items=orders.filter(order=>column.statuses.includes(order.status)).slice(0,4);
    return `<div class="oa-board-col"><div class="oa-board-title"><span>${column.label}</span><b>${column.statuses.reduce((sum,status)=>sum+(d.counts[status]||0),0)}</b></div>${items.map(oaOrderCard).join('')||'<div class="empty" style="padding:24px 8px;font-size:11px">Sem OS</div>'}</div>`;
  }).join('');

  setContent(`
    <div class="oa-kpi-grid">
      ${oaKpi('OS abertas',d.counts.ABERTAS,'active')}
      ${oaKpi('Em diagnóstico',d.counts.DIAGNOSTICO)}
      ${oaKpi('Aguard. aprovação',d.counts.AGUARDANDO_APROVACAO,'warn')}
      ${oaKpi('Em serviço',d.counts.EM_SERVICO,'active')}
      ${oaKpi('Prontas',d.counts.PRONTA,'ready')}
      ${f?oaKpi('Faturamento do período',money(f.invoicedCents),'accent'):''}
    </div>
    <section class="oa-board-card">
      <div class="oa-board-head"><div><h2>Ordens por status</h2><small>Acompanhamento rápido do fluxo da oficina</small></div><button class="btn sm" data-go="work-orders">Ver todas</button></div>
      <div class="oa-board">${pipeline}</div>
    </section>
    <div class="oa-lower-grid">
      <div class="card"><div class="card-head"><h2>Próximos compromissos</h2><button class="btn sm" data-go="schedule">Ver agenda</button></div>
        ${d.upcoming.length?`<div class="list">${d.upcoming.slice(0,6).map(e=>`<div class="list-item"><div><strong>${esc(e.title)}</strong><br><small>${esc(e.customer_name||'')} ${e.os_number?`• OS #${e.os_number}`:''}</small></div><small>${dt(e.starts_at)}</small></div>`).join('')}</div>`:'<div class="empty">Nenhum compromisso próximo.</div>'}
      </div>
      <div class="card"><div class="card-head"><h2>Estoque crítico</h2><button class="btn sm" data-go="inventory">Ver estoque</button></div>
        ${d.lowStock.length?`<div class="list">${d.lowStock.slice(0,6).map(p=>`<div class="list-item"><div><strong>${esc(p.description)}</strong><br><small>${esc(p.sku)}</small></div><span class="pill orange">${p.quantity} / mín. ${p.min_stock}</span></div>`).join('')}</div>`:'<div class="empty">Estoque dentro dos mínimos.</div>'}
      </div>
    </div>`);

  $$('[data-go]').forEach(button=>button.onclick=()=>navigate(button.dataset.go));
  $$('[data-oa-os]').forEach(card=>card.onclick=()=>openWorkOrder(card.dataset.oaOs));
}

function oaStatusCounts(orders){
  return OA_PIPELINE.map(column=>({
    label:column.label,
    count:orders.filter(order=>column.statuses.includes(order.status)).length,
  }));
}

async function renderReports(){
  pageTitle('Relatórios','VISÃO OPERACIONAL');
  const now=new Date();
  const from=new Date(now.getFullYear(),now.getMonth(),1,0,0,0,0);
  const to=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59,999);
  const qs=`from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  const financeAllowed=['ADMIN','FINANCEIRO'].includes(state.user.role);
  const [dashboard,finance]=await Promise.all([
    api('/api/dashboard'),
    financeAllowed?api(`/api/finance/summary?${qs}`):Promise.resolve(null),
  ]);
  const status=OA_PIPELINE.map(column=>({label:column.label,count:column.statuses.reduce((sum,s)=>sum+(dashboard.counts[s]||0),0)}));
  const max=Math.max(1,...status.map(item=>item.count));
  const completed=dashboard.counts.ENTREGUES_MES;
  const active=dashboard.counts.ABERTAS;

  setContent(`
    <div class="section-head"><div><h2>Resumo do mês</h2><span class="muted">Indicadores derivados dos dados atuais do sistema</span></div></div>
    <div class="oa-report-grid">
      <div class="oa-report-card"><small>OS em fluxo (atual)</small><strong>${active}</strong></div>
      <div class="oa-report-card"><small>OS entregues (mês)</small><strong>${completed}</strong></div>
      <div class="oa-report-card"><small>Itens abaixo do mínimo</small><strong>${dashboard.counts.ESTOQUE_CRITICO}</strong></div>
      <div class="oa-report-card"><small>${financeAllowed?'Resultado do mês':'Compromissos próximos'}</small><strong>${financeAllowed?money(finance.resultCents):dashboard.upcoming.length}</strong></div>
    </div>
    <div class="oa-report-layout">
      <div class="card"><div class="card-head"><h2>Distribuição das ordens</h2><span class="muted">Fluxo atual</span></div><div class="oa-bars">
        ${status.map(item=>`<div class="oa-bar-row"><span>${esc(item.label)}</span><div class="oa-bar-track"><i style="width:${Math.round(item.count/max*100)}%"></i></div><b>${item.count}</b></div>`).join('')}
      </div></div>
      <div class="card"><div class="card-head"><h2>Financeiro</h2><span class="muted">Período atual</span></div>
        ${financeAllowed?`<div class="list"><div class="list-item"><span>Faturado</span><strong>${money(finance.invoicedCents)}</strong></div><div class="list-item"><span>Recebido</span><strong>${money(finance.receivedCents)}</strong></div><div class="list-item"><span>Pendente</span><strong>${money(finance.pendingCents)}</strong></div><div class="list-item"><span>Despesas</span><strong>${money(finance.expensesCents)}</strong></div></div>`:'<div class="oa-report-note">Seu perfil não possui acesso aos indicadores financeiros. Os dados operacionais continuam disponíveis.</div>'}
      </div>
    </div>`);
}

function oaSearchText(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function oaMatch(query,...values){const q=oaSearchText(query);return values.some(value=>oaSearchText(value).includes(q))}

let globalSearchEpoch=0;
async function runGlobalSearch(query){
  const epoch=++globalSearchEpoch;
  const q=query.trim();
  if(q.length<2){toast('Digite pelo menos 2 caracteres.',true);return}
  const [customers,machines,orders]=await Promise.all([api('/api/customers'),api('/api/machines'),api('/api/work-orders')]);
  if(epoch!==globalSearchEpoch)return;
  const customerResults=customers.filter(item=>oaMatch(q,item.name,item.document,item.phone)).slice(0,6);
  const machineResults=machines.filter(item=>oaMatch(q,item.brand,item.model,item.type,item.serial_number,item.internal_id)).slice(0,6);
  const orderResults=orders.filter(item=>oaMatch(q,item.os_number,item.customer_name,item.machine_brand,item.machine_model,item.problem_reported)).slice(0,8);
  const total=customerResults.length+machineResults.length+orderResults.length;
  const group=(title,items,render)=>items.length?`<section class="oa-search-group"><h3>${title}</h3>${items.map(render).join('')}</section>`:'';

  showModal(`Busca — ${q}`,total?`<div class="oa-search-results">
    ${group('Ordens de Serviço',orderResults,item=>`<div class="oa-search-result"><div><strong>OS #${item.os_number} · ${esc(item.customer_name)}</strong><small>${esc([item.machine_brand,item.machine_model].filter(Boolean).join(' '))}</small></div><button class="btn sm" data-search-os="${item.id}">Abrir</button></div>`)}
    ${group('Clientes',customerResults,item=>`<div class="oa-search-result"><div><strong>${esc(item.name)}</strong><small>${esc(item.document||item.phone||'')}</small></div><button class="btn sm" data-search-go="customers">Ver clientes</button></div>`)}
    ${group('Máquinas',machineResults,item=>`<div class="oa-search-result"><div><strong>${esc([item.brand,item.model].filter(Boolean).join(' ')||item.type)}</strong><small>${esc(item.serial_number||item.internal_id||'')}</small></div><button class="btn sm" data-search-go="machines">Ver máquinas</button></div>`)}
  </div>`:'<div class="empty">Nenhum cliente, máquina ou OS encontrado.</div>');

  $$('[data-search-os]').forEach(button=>button.onclick=()=>{closeModal();openWorkOrder(button.dataset.searchOs)});
  $$('[data-search-go]').forEach(button=>button.onclick=()=>{closeModal();navigate(button.dataset.searchGo)});
}

function bindGlobalSearch(){
  const input=$('#globalSearch');
  if(!input)return;
  const clear=$('#clearGlobalSearch');
  const submit=$('#submitGlobalSearch');
  function clearSearch(){globalSearchEpoch++;input.value='';clear.classList.add('hidden');input.focus()}
  clear.onclick=clearSearch;
  input.addEventListener('input',()=>{globalSearchEpoch++;clear.classList.toggle('hidden',!input.value)});
  submit.onclick=()=>runGlobalSearch(input.value).catch(error=>toast(error.message,true));
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();runGlobalSearch(input.value).catch(error=>toast(error.message,true))}
    if(event.key==='Escape'){clearSearch()}
  });
  document.addEventListener('keydown',event=>{
    const tag=document.activeElement?.tagName;
    if(event.key==='/'&&!event.isComposing&&$('#modal').classList.contains('hidden')&&!['INPUT','TEXTAREA','SELECT'].includes(tag)){event.preventDefault();input.focus()}
  });
}

bindGlobalSearch();

