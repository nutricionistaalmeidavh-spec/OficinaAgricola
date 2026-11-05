
function oaKpi(label,value,kind=''){
  return `<div class="oa-kpi-card ${kind}"><div class="oa-kpi-label"><span>${esc(label)}</span><i class="oa-kpi-dot"></i></div><strong>${value}</strong></div>`;
}

function oaOrderCard(order){
  const machine=[order.machine_brand,order.machine_model].filter(Boolean).join(' ')||'Equipamento não informado';
  return `<button type="button" class="oa-order-mini" data-oa-os="${order.id}"><strong>OS #${order.os_number} · ${esc(order.customer_name)}</strong><p>${esc(machine)}<br>${esc(order.problem_reported||'Sem descrição')}</p>${badge(order.status)}</button>`;
}

async function renderDashboard(){
  pageTitle('Visão Geral','OPERAÇÃO EM TEMPO REAL');
  const d=await api('/api/dashboard');
  const f=d.finance||null;
  const pipeline=d.flow.map(column=>{
    const group=d.board?.[column.key]||{count:0,items:[]};
    const items=group.items;
    return `<div class="oa-board-col"><div class="oa-board-title"><span>${column.label}</span><b>${group.count}</b></div>${items.map(oaOrderCard).join('')||'<div class="empty" style="padding:24px 8px;font-size:11px">Nenhuma OS nesta etapa.</div>'}${group.count>items.length?`<small class="muted">${group.count-items.length} outras OS · Ver todas</small>`:''}</div>`;
  }).join('');

  const firstUse=!d.counts.ABERTAS&&!d.counts.ENTREGUE&&!d.counts.CANCELADA&&!d.counts.REPROVADA&&!d.counts.TRANSFERIDA;
  setContent(`
    ${firstUse&&['ADMIN','ATENDIMENTO'].includes(state.user.role)?`<section class="card"><h2>Comece pelo primeiro atendimento</h2><p>Cadastre o cliente e o veículo durante a abertura da OS. Depois registre diagnóstico, orçamento, execução, pagamento e entrega.</p><div class="action-row"><button class="btn primary" id="startFirstOrder">Abrir primeiro atendimento</button>${state.user.role==='ADMIN'?'<button class="btn" data-go="settings">Conferir dados da empresa</button>':''}</div><p class="muted">Estoque, caixa e fiscal podem ser preparados quando forem necessários. Nenhuma integração paga é obrigatória.</p></section>`:''}
    <div class="oa-kpi-grid">
      ${oaKpi('OS abertas',d.counts.ABERTAS,'active')}
      ${oaKpi('Em diagnóstico',d.counts.DIAGNOSTICO)}
      ${oaKpi('Aguard. aprovação',d.counts.AGUARDANDO_APROVACAO,'warn')}
      ${oaKpi('Em serviço',d.counts.EM_SERVICO,'active')}
      ${oaKpi('Prontas',d.counts.PRONTA,'ready')}
      ${f?oaKpi('Aprovado/vendido no mês',money(f.invoicedCents),'accent'):''}
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

  if($('#startFirstOrder'))$('#startFirstOrder').onclick=openNewWorkOrder;
  $$('[data-go]').forEach(button=>button.onclick=()=>navigate(button.dataset.go));
  $$('[data-oa-os]').forEach(card=>card.onclick=()=>openWorkOrder(card.dataset.oaOs));
}

async function renderReports(){
  pageTitle('Relatórios','VISÃO OPERACIONAL');
  const now=new Date();
  const from=new Date(now.getFullYear(),now.getMonth(),1,0,0,0,0);
  const to=new Date(now.getFullYear(),now.getMonth()+1,1,0,0,0,0);
  const qs=`from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  const financeAllowed=['ADMIN','FINANCEIRO'].includes(state.user.role);
  const report=await api('/api/reports?'+qs);
  const finance=report.finance;
  const status=report.flow.map(column=>({label:column.label,count:column.statuses.reduce((n,key)=>n+(report.statusCounts[key]||0),0)}));
  const max=Math.max(1,...status.map(item=>item.count));
  const completed=report.deliveredCount;
  const active=report.openCount;

  setContent(`
    <div class="section-head"><div><h2>Resumo do mês</h2><span class="muted">Dados consolidados das operações da oficina</span></div></div>
    <div class="oa-report-grid">
      <div class="oa-report-card"><small>OS em fluxo</small><strong>${active}</strong></div>
      <div class="oa-report-card"><small>OS entregues no mês</small><strong>${completed}</strong></div>
      <div class="oa-report-card"><small>Itens abaixo do mínimo</small><strong>${report.lowStockCount}</strong></div>
      <div class="oa-report-card"><small>${financeAllowed?'Resultado do mês':'Total de OS'}</small><strong>${financeAllowed?money(finance.resultCents):report.totalCount}</strong></div>
    </div>
    <div class="oa-report-layout">
      <div class="card"><div class="card-head"><h2>Distribuição das ordens</h2><span class="muted">Fluxo atual</span></div><div class="oa-bars">
        ${status.map(item=>`<div class="oa-bar-row"><span>${esc(item.label)}</span><div class="oa-bar-track"><i style="width:${Math.round(item.count/max*100)}%"></i></div><b>${item.count}</b></div>`).join('')}
      </div></div>
      <div class="card"><div class="card-head"><h2>Financeiro</h2><span class="muted">Recebimentos e despesas pela data do evento; aprovações pela data de aprovação. Valores comerciais não significam notas emitidas.</span></div>
        ${financeAllowed?`<div class="list"><div class="list-item"><span>Aprovado/vendido no período</span><strong>${money(finance.invoicedCents)}</strong></div><div class="list-item"><span>Recebido</span><strong>${money(finance.receivedCents)}</strong></div><div class="list-item"><span>A receber das aprovações do período</span><strong>${money(finance.pendingCents)}</strong></div><div class="list-item"><span>Despesas</span><strong>${money(finance.expensesCents)}</strong></div></div>`:'<div class="oa-report-note">Seu perfil não possui acesso aos indicadores financeiros. Os dados operacionais continuam disponíveis.</div>'}
      </div>
    </div>`);
}

function oaSearchText(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function oaMatch(query,...values){const q=oaSearchText(query);return values.some(value=>oaSearchText(value).includes(q))}

let globalSearchEpoch=0;
async function runGlobalSearch(query){
  const epoch=++globalSearchEpoch,q=query.trim();
  if(q.length<2){toast('Digite pelo menos 2 caracteres.',true);return;}
  const term=encodeURIComponent(q);
  const [customers,machines,orders]=await Promise.all([
    api('/api/customers/page?includeInactive=1&limit=20&search='+term),
    api('/api/machines/page?includeInactive=1&limit=20&search='+term),
    api('/api/work-orders/page?limit=20&search='+term)
  ]);
  if(epoch!==globalSearchEpoch)return;
  const groups=[
    {key:'orders',title:'Ordens de Serviço',path:'/api/work-orders/page',page:orders,
      render:item=>`<strong>OS #${item.os_number} · ${esc(item.customer_name)}</strong><small>${esc([item.machine_brand,item.machine_model].filter(Boolean).join(' '))}</small>`,
      open:item=>openWorkOrder(item.id)},
    {key:'customers',title:'Clientes',path:'/api/customers/page',page:customers,
      render:item=>`<strong>${esc(item.name)}</strong><small>${esc(item.document||item.phone||'')}</small>`,
      open:item=>['ADMIN','ATENDIMENTO'].includes(state.user.role)?customerModal(item):showModal(item.name,`<p>${esc(item.phone||'Sem telefone')}</p>`)},
    {key:'machines',title:'Veículos e equipamentos',path:'/api/machines/page',page:machines,
      render:item=>`<strong>${esc([item.brand,item.model].filter(Boolean).join(' ')||item.type)}</strong><small>${esc(item.license_plate||item.vin||item.serial_number||item.internal_id||'')}</small>`,
      open:item=>machineHistoryModal(item.id)}
  ];
  const total=customers.total+machines.total+orders.total;
  showModal(`Busca — ${q}`,total?groups.map(g=>`<section id="search-${g.key}"></section>`).join(''):'<div class="empty">Nenhum cliente, máquina ou OS encontrado.</div>');
  if(!total)return;
  const modalToken=state.modalToken;
  for(const group of groups){
    let rows=[...group.page.items],cursor=group.page.nextCursor;
    const paint=()=>{
      const host=$('#search-'+group.key);if(!host)return;
      renderRegion(host,`<h3>${group.title}</h3><p role="status">${rows.length} de ${group.page.total} resultado(s)</p>`+
        (rows.length?rows.map(item=>`<div class="oa-search-result"><div>${group.render(item)}</div><button class="btn sm" type="button" data-result="${item.id}">Abrir</button></div>`).join(''):'<p class="muted">Nenhum resultado para esta busca.</p>')+
        (cursor?'<button class="btn sm" type="button" data-search-more>Carregar mais resultados</button>':''));
      $$('[data-result]',host).forEach(button=>button.onclick=()=>Promise.resolve(group.open(rows.find(item=>String(item.id)===button.dataset.result))).catch(error=>toast(error.message,true)));
      const more=$('[data-search-more]',host);
      if(more)more.onclick=async()=>{
        more.disabled=true;
        try{
          const page=await api(group.path+'?includeInactive=1&limit=20&search='+term+'&cursor='+encodeURIComponent(cursor));
          if(epoch!==globalSearchEpoch||state.modalToken!==modalToken)return;
          rows=rows.concat(page.items);cursor=page.nextCursor;paint();
        }catch(error){toast(error.message,true);more.textContent='Tentar novamente';more.disabled=false;}
      };
    };
    paint();
  }
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

