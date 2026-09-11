import { getWorkOrder } from './services/work-orders.js';
import { getQuote } from './services/quotes.js';

const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=(cents)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100).replace('R$ ','R$ ');
const date=(v)=>v?new Date(v).toLocaleString('pt-BR'):'—';

export function renderDocument(db,workOrderId,kind='work-order'){
  const allowed=new Set(['quote','work-order','delivery','receipt']); if(!allowed.has(kind)) throw new Error('Documento inválido');
  const os=getWorkOrder(db,workOrderId); const company=db.prepare('SELECT * FROM company_settings WHERE id=1').get();
  const customer=JSON.parse(os.snapshot_customer); const machine=JSON.parse(os.snapshot_machine);
  let quote=null; try{quote=getQuote(db,workOrderId)}catch{}
  const receipts=db.prepare('SELECT * FROM receipts WHERE work_order_id=? AND reversed_at IS NULL ORDER BY received_at').all(workOrderId);
  const titles={quote:'Orçamento', 'work-order':'Ordem de Serviço', delivery:'Resumo de Entrega', receipt:'Recibo'};
  const rows=quote?.items?.map(i=>`<tr><td>${esc(i.description)}</td><td>${esc(i.kind.replaceAll('_',' '))}</td><td>${esc(i.quantity)}</td><td>${money(i.unit_price_cents)}</td><td>${money(i.total_cents)}</td></tr>`).join('')||'';
  const receiptRows=receipts.map(r=>`<tr><td>${date(r.received_at)}</td><td>${esc(r.method)}</td><td>${money(r.amount_cents)}</td></tr>`).join('');
  const body=kind==='receipt'
    ? `<h2>Recebimentos</h2><table><thead><tr><th>Data</th><th>Forma</th><th>Valor</th></tr></thead><tbody>${receiptRows||'<tr><td colspan="3">Nenhum recebimento registrado</td></tr>'}</tbody></table>`
    : `${kind!=='quote'?`<h2>Serviço</h2><p><strong>Problema relatado:</strong> ${esc(os.problem_reported)}</p><p><strong>Diagnóstico:</strong> ${esc(os.diagnosis)||'—'}</p>`:''}
      ${quote?`<h2>Itens</h2><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><p>Subtotal: ${money(quote.subtotal_cents)}</p><p>Desconto: ${money(quote.discount_cents)}</p><strong>Total: ${money(quote.total_cents)}</strong></div>`:''}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titles[kind]} OS ${os.os_number}</title><style>
    body{font-family:Arial,sans-serif;color:#1b2a22;max-width:900px;margin:32px auto;padding:0 24px} header{border-bottom:3px solid #075b3a;padding-bottom:16px;margin-bottom:24px} h1{color:#075b3a;margin:0} h2{margin-top:28px} .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px} table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #ddd;padding:9px;text-align:left}.totals{text-align:right;margin-top:16px}small{color:#667}</style></head><body>
    <header><h1>${esc(company.name)}</h1><div>${esc(company.document)} ${esc(company.phone)}</div><h2>${titles[kind]} — OS #${os.os_number}</h2></header>
    <section class="meta"><div><strong>Cliente</strong><br>${esc(customer.name)}<br>${esc(customer.document)}</div><div><strong>Máquina</strong><br>${esc(machine.type)} ${esc(machine.brand)} ${esc(machine.model)}<br>Série: ${esc(machine.serialNumber)||'—'}</div><div><strong>Entrada</strong><br>${date(os.entered_at)}</div><div><strong>Status</strong><br>${esc(os.status)}</div></section>
    ${body}<footer><p><small>Documento gerado localmente pelo ArtiSys Oficina Agrícola.</small></p></footer></body></html>`;
}
