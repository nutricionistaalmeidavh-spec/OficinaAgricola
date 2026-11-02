import { lowStockParts } from './inventory.js';
import { listSchedule } from './operations.js';
import { financeSummary } from './finance.js';

export function dashboardData(db,{now=new Date()}={}){
  const statuses=['ENTRADA','DIAGNOSTICO','AGUARDANDO_APROVACAO','EM_SERVICO','PRONTA']; const counts={};
  for(const status of statuses) counts[status]=Number(db.prepare('SELECT COUNT(*) n FROM work_orders WHERE status=?').get(status).n);
  counts.ABERTAS=Number(db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','REPROVADA')").get().n);
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)); const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)-1);
  const finance=financeSummary(db,{from:start.toISOString(),to:end.toISOString()});
  const upcoming=listSchedule(db,{from:now.toISOString(),to:new Date(now.getTime()+30*24*60*60*1000).toISOString()}).slice(0,8);
  return {counts,finance,upcoming,lowStock:lowStockParts(db).slice(0,8)};
}
