const $=(s,root=document)=>root.querySelector(s); const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const state={token:localStorage.getItem('oficina_token')||'',user:null,page:'dashboard'};
const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
const dt=v=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
async function api(path,{method='GET',body,raw=false}={}){const headers={};if(state.token)headers.Authorization=`Bearer ${state.token}`;if(body!==undefined)headers['Content-Type']='application/json';const res=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});if(res.status===401){logout();throw new Error('Sessão expirada')}const text=await res.text();if(!res.ok){let msg=text;try{msg=JSON.parse(text).error}catch{}throw new Error(msg||'Erro na operação')}return raw?text:(text?JSON.parse(text):null)}
function toast(msg,error=false){const el=$('#toast');el.textContent=msg;el.className=`toast${error?' error':''}`;setTimeout(()=>el.classList.add('hidden'),2800)}
function showModal(title,html,onSubmit){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;$('#modal').classList.remove('hidden');const form=$('#modalBody form');if(form&&onSubmit)form.addEventListener('submit',async e=>{e.preventDefault();const btn=$('button[type=submit]',form);if(btn)btn.disabled=true;try{await onSubmit(new FormData(form));closeModal()}catch(err){toast(err.message,true)}finally{if(btn)btn.disabled=false}})}
function closeModal(){$('#modal').classList.add('hidden');$('#modalBody').innerHTML=''}
function formObj(fd){return Object.fromEntries([...fd.entries()].map(([k,v])=>[k,typeof v==='string'?v.trim():v]))}
function badge(status){const cls=/PRONTA|ENTREGUE|APROVADA|PAGO/.test(status)?'green':/AGUARDANDO|ORCAMENTO|PARCIAL/.test(status)?'orange':/CANCELADA|REPROVADA/.test(status)?'red':'blue';return `<span class="pill ${cls}">${esc(status.replaceAll('_',' '))}</span>`}
function pageTitle(title,eyebrow='OFICINA'){ $('#pageTitle').textContent=title;$('#pageEyebrow').textContent=eyebrow }
function setContent(html){$('#content').innerHTML=html}

async function boot(){ $('#today').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}); if(!state.token)return showLogin();try{state.user=await api('/api/auth/me');showApp();await navigate('dashboard')}catch{showLogin()} }
function showLogin(){$('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden')}
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#userName').textContent=state.user.name;$('#userRole').textContent=state.user.role;$('#avatar').textContent=state.user.name[0]?.toUpperCase()||'A'}
function logout(){state.token='';state.user=null;localStorage.removeItem('oficina_token');showLogin()}

async function navigate(page){state.page=page;$$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));setContent('<div class="card"><div class="empty">Carregando…</div></div>');try{const fn={dashboard:renderDashboard,customers:renderCustomers,machines:renderMachines,'work-orders':renderWorkOrders,inventory:renderInventory,schedule:renderSchedule,finance:renderFinance,reports:renderReports,technicians:renderTechnicians,settings:renderSettings}[page]||renderDashboard;await fn()}catch(err){setContent(`<div class="card"><div class="empty error">${esc(err.message)}</div></div>`);toast(err.message,true)}}

async function renderDashboard(){pageTitle('Visão Geral','OPERAÇÃO EM TEMPO REAL');const d=await api('/api/dashboard');const f=d.finance;setContent(`
 <div class="grid stats">
  ${stat('OS abertas',d.counts.ABERTAS)}${stat('Em diagnóstico',d.counts.DIAGNOSTICO)}${stat('Aguard. aprovação',d.counts.AGUARDANDO_APROVACAO)}${stat('Em serviço',d.counts.EM_SERVICO)}${stat('Prontas',d.counts.PRONTA)}${stat('Faturamento',money(f.invoicedCents),'accent')}
 </div>
 <div class="grid two-col"><div class="card"><div class="card-head"><h2>Próximos compromissos</h2><button class="btn sm" data-go="schedule">Ver agenda</button></div>${d.upcoming.length?`<div class="list">${d.upcoming.map(e=>`<div class="list-item"><div><strong>${esc(e.title)}</strong><br><small>${esc(e.customer_name||'')} ${e.os_number?`• OS #${e.os_number}`:''}</small></div><small>${dt(e.starts_at)}</small></div>`).join('')}</div>`:'<div class="empty">Nenhum compromisso próximo.</div>'}</div>
 <div class="card"><div class="card-head"><h2>Estoque crítico</h2><button class="btn sm" data-go="inventory">Ver estoque</button></div>${d.lowStock.length?`<div class="list">${d.lowStock.map(p=>`<div class="list-item"><div><strong>${esc(p.description)}</strong><br><small>${esc(p.sku)}</small></div><span class="pill orange">${p.quantity} / mín. ${p.min_stock}</span></div>`).join('')}</div>`:'<div class="empty">Estoque dentro dos mínimos.</div>'}</div></div>`);$$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go))}
function stat(label,value,cls=''){return `<div class="stat"><small>${label}</small><strong class="${cls}">${value}</strong></div>`}
