async function renderMarketParity(){
 pageTitle('CRM e frotas','PÓS-VENDA E UNIDADES');
 const [tasks,units,fleets,refs]=await Promise.all([api('/api/crm/tasks'),api('/api/units'),api('/api/fleets'),api('/api/technical-references')]);
 const office=['ADMIN','ATENDIMENTO'].includes(state.user.role),admin=state.user.role==='ADMIN';
 setContent('<div class="section-head"><h2>Gestão de relacionamento</h2></div>'+ '<div class="stats">'+stat('Pendentes',tasks.length)+stat('Frotas',fleets.length)+stat('Unidades',units.length)+stat('Referências',refs.length)+'</div>'+ '<div class="card"><h3>CRM</h3>'+table(['Cliente','Ação','Data'],tasks.map(t=>[esc(t.customer_name),esc(t.title),esc(t.due_at)]))+'</div>'+ '<div class="card"><h3>Frotas</h3>'+table(['Frota','Cliente','Veículos'],fleets.map(f=>[esc(f.name),esc(f.customer_name),String(f.vehicle_count)]))+'</div>');
}
