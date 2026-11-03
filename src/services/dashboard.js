import { lowStockParts } from './inventory.js';
import { listSchedule } from './operations.js';
import { financeSummary } from './finance.js';

export function dashboardData(db,{now=new Date(),role='ADMIN'}={}){
  const statuses=['ENTRADA','DIAGNOSTICO','ORCAMENTO','AGUARDANDO_APROVACAO','APROVADA','EM_SERVICO','PRONTA','ENTREGUE','CANCELADA','REPROVADA']; const counts={};
  for(const status of statuses) counts[status]=Number(db.prepare('SELECT COUNT(*) n FROM work_orders WHERE status=?').get(status).n);
  counts.ABERTAS=Number(db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','REPROVADA')").get().n);
  const start=new Date(now.getFullYear(),now.getMonth(),1);
  const nextMonth=new Date(now.getFullYear(),now.getMonth()+1,1);
  const end=new Date(nextMonth.getTime()-1);
  counts.ENTREGUES_MES=Number(db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status='ENTREGUE' AND delivered_at>=? AND delivered_at<?").get(start.toISOString(),nextMonth.toISOString()).n);
  const canReadFinance=['ADMIN','FINANCEIRO'].includes(role);
  const finance=canReadFinance?financeSummary(db,{from:start.toISOString(),to:end.toISOString()}):null;
  const upcoming=listSchedule(db,{from:now.toISOString(),to:new Date(now.getTime()+30*24*60*60*1000).toISOString()}).slice(0,8);
  const lowStock=lowStockParts(db);
  counts.ESTOQUE_CRITICO=lowStock.length;
  return {...(finance?{finance}:{}),counts,upcoming,lowStock};
}
