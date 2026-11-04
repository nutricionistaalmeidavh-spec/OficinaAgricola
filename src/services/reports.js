import { financeSummary } from './finance.js';

function dateBound(value,label){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error(label+' inválida');
  return new Date(value).toISOString();
}

// Métricas sempre computadas no servidor diretamente no SQLite.
// Nenhuma contagem depende de /api/work-orders ou de LIMIT do dashboard.
export function getOperationalReport(db,{from,to,includeFinance=true}={}){
  const start=dateBound(from||new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString(),'Data inicial');
  const end=dateBound(to||new Date(new Date().getFullYear(),new Date().getMonth()+1,1).toISOString(),'Data final');
  if(start>=end)throw new Error('Período inválido');
  const rows=db.prepare('SELECT status,COUNT(*) n FROM work_orders GROUP BY status').all();
  const statusCounts=Object.fromEntries(rows.map(row=>[row.status,Number(row.n)]));
  const openCount=Number(db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','REPROVADA','TRANSFERIDA')").get().n);
  const deliveredCount=Number(db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status='ENTREGUE' AND delivered_at>=? AND delivered_at<?").get(start,end).n);
  const lowStockCount=Number(db.prepare('SELECT COUNT(*) n FROM parts WHERE active=1 AND quantity<=min_stock').get().n);
  const totalCount=rows.reduce((sum,row)=>sum+Number(row.n),0);
  // financeSummary usa intervalo fechado, converte-se o extremo superior exclusivo.
  const finance=includeFinance?financeSummary(db,{from:start,to:new Date(Date.parse(end)-1).toISOString()}):null;
  return {from:start,to:end,totalCount,openCount,deliveredCount,lowStockCount,statusCounts,finance};
}
