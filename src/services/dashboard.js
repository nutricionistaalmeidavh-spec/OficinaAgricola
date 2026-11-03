import { lowStockParts } from './inventory.js';
import { listSchedule } from './operations.js';
import { financeSummary } from './finance.js';
import {listMaintenanceAlerts} from './automotive.js';

export function dashboardData(db,{now=new Date(),role='ADMIN'}={}){
  const statuses=['ENTRADA','DIAGNOSTICO','AGUARDANDO_APROVACAO','EM_SERVICO','PRONTA']; const counts={};
  for(const status of statuses) counts[status]=Number(db.prepare('SELECT COUNT(*) n FROM work_orders WHERE status=?').get(status).n);
  counts.ABERTAS=Number(db.prepare("SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ('ENTREGUE','CANCELADA','REPROVADA')").get().n);
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)); const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)-1);
  const canReadFinance=['ADMIN','FINANCEIRO'].includes(role);
  const finance=canReadFinance?financeSummary(db,{from:start.toISOString(),to:end.toISOString()}):null;
  const upcoming=listSchedule(db,{from:now.toISOString(),to:new Date(now.getTime()+30*24*60*60*1000).toISOString()}).slice(0,8);
  return {...(finance?{finance}:{}),counts,upcoming,lowStock:lowStockParts(db).slice(0,8),maintenanceAlerts:listMaintenanceAlerts(db).slice(0,8)};
}
