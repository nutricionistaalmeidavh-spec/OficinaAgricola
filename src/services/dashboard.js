import { lowStockParts } from './inventory.js';
import { listSchedule } from './operations.js';
import { financeSummary } from './finance.js';

export function dashboardData(db,{now=new Date()}={}){
  const statuses=['ENTRADA','DIAGNOSTICO','AGUARDANDO_APROVACAO','EM_SERVICO','PRONTA']; const counts={};
  for(const status of statuses) counts[status]=Number(db.prepare('SELECT COUNT(*) n FROM work_orders WHERE status=?').get(status).n);
  counts.ABERTAS=Number(db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','REPROVADA')").get().n);
  const board={};
  const groups={
    entrada:['ENTRADA'],diagnostico:['DIAGNOSTICO','ORCAMENTO'],
    aprovacao:['AGUARDANDO_APROVACAO','APROVADA'],servico:['EM_SERVICO'],pronta:['PRONTA']
  };
  for(const [key,group] of Object.entries(groups)){
    const where=group.map(()=>'?').join(',');
    const count=Number(db.prepare('SELECT COUNT(*) n FROM work_orders WHERE status IN ('+where+')').get(...group).n);
    const items=db.prepare('SELECT wo.id,wo.os_number,wo.status,wo.problem_reported,c.name customer_name,m.brand machine_brand,m.model machine_model FROM work_orders wo JOIN customers c ON c.id=wo.customer_id JOIN machines m ON m.id=wo.machine_id WHERE wo.status IN ('+where+') ORDER BY wo.id DESC LIMIT 4').all(...group);
    board[key]={count,items};
  }
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)); const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)-1);
  const finance=financeSummary(db,{from:start.toISOString(),to:end.toISOString()});
  const upcoming=listSchedule(db,{from:now.toISOString(),to:new Date(now.getTime()+30*24*60*60*1000).toISOString()}).slice(0,8);
  return {counts,board,finance,upcoming,lowStock:lowStockParts(db).slice(0,8)};
}
