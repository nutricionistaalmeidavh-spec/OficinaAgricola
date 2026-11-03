import {createHash,randomBytes} from 'node:crypto';
import {nowIso,transaction} from '../db.js';
import {getQuote,approveQuote,rejectQuote} from './quotes.js';

const clean=value=>String(value??'').trim();
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const date=value=>{const v=clean(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new Error('Data inválida');return v;};
const requireRow=(db,table,id,label)=>{const key=validId(id);const row=key?db.prepare('SELECT * FROM '+table+' WHERE id=?').get(key):null;if(!row)throw new Error(label+' não encontrado');return row;};
const sha=value=>createHash('sha256').update(value).digest('hex');
const PLATE=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export function migrateMarketParity(db){
 db.exec("CREATE TABLE IF NOT EXISTS crm_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL REFERENCES customers(id),machine_id INTEGER REFERENCES machines(id),work_order_id INTEGER REFERENCES work_orders(id),title TEXT NOT NULL,due_at TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('MANUAL','TELEFONE','EMAIL','WHATSAPP')),notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','CONCLUIDA')),outcome TEXT NOT NULL DEFAULT '',dedupe_key TEXT UNIQUE,created_at TEXT NOT NULL,completed_at TEXT)");
 db.exec("CREATE INDEX IF NOT EXISTS idx_crm_due ON crm_tasks(status,due_at)");
 db.exec("CREATE TABLE IF NOT EXISTS shop_units (id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),created_at TEXT NOT NULL)");
 db.prepare("INSERT OR IGNORE INTO shop_units(id,code,name,created_at) VALUES(1,'MATRIZ','Matriz',?)").run(nowIso());
 const osColumns=new Set(db.prepare("PRAGMA table_info('work_orders')").all().map(row=>row.name));
 if(!osColumns.has('unit_id'))db.exec("ALTER TABLE work_orders ADD COLUMN unit_id INTEGER REFERENCES shop_units(id)");
 db.exec('UPDATE work_orders SET unit_id=1 WHERE unit_id IS NULL');
 db.exec("CREATE INDEX IF NOT EXISTS idx_os_unit ON work_orders(unit_id)");
 db.exec("CREATE TABLE IF NOT EXISTS fleets (id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL REFERENCES customers(id),name TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(customer_id,name))");
 db.exec("CREATE TABLE IF NOT EXISTS fleet_vehicles (fleet_id INTEGER NOT NULL REFERENCES fleets(id),machine_id INTEGER NOT NULL REFERENCES machines(id),created_at TEXT NOT NULL,PRIMARY KEY(fleet_id,machine_id))");
 db.exec("CREATE TABLE IF NOT EXISTS technical_references (id INTEGER PRIMARY KEY AUTOINCREMENT,part_id INTEGER NOT NULL REFERENCES parts(id),manufacturer TEXT NOT NULL DEFAULT '',oem_code TEXT NOT NULL DEFAULT '',reference_code TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',verified INTEGER NOT NULL DEFAULT 0 CHECK(verified=0),created_at TEXT NOT NULL)");
 db.exec("CREATE INDEX IF NOT EXISTS idx_tech_refs_part ON technical_references(part_id)");
 db.exec("CREATE TABLE IF NOT EXISTS quote_approval_links (id INTEGER PRIMARY KEY AUTOINCREMENT,work_order_id INTEGER NOT NULL REFERENCES work_orders(id),token_hash TEXT NOT NULL UNIQUE,quote_digest TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ATIVO' CHECK(status IN ('ATIVO','APROVADO','REJEITADO','REVOGADO')),created_at TEXT NOT NULL,responded_at TEXT)");
 db.exec("CREATE INDEX IF NOT EXISTS idx_approvals_os ON quote_approval_links(work_order_id,status)");
}

export function lookupVehicleByPlate(db,input){
 const plate=clean(input).toUpperCase().replace(/[\s-]/g,'');
 if(!PLATE.test(plate))throw new Error('Placa inválida');
 const row=db.prepare("SELECT id,customer_id,type,brand,model,year,license_plate,vin,engine,fuel_type,odometer_km FROM machines WHERE license_plate=?").get(plate);
 return row?{...row,source:'LOCAL'}:null;
}
export function createCrmTask(db,input={}){
 return transaction(db,()=>{
  const customer=requireRow(db,'customers',input.customerId,'Cliente');
  const machine=input.machineId==null?null:requireRow(db,'machines',input.machineId,'Veículo');
  const order=input.workOrderId==null?null:requireRow(db,'work_orders',input.workOrderId,'OS');
  if(machine&&Number(machine.customer_id)!==customer.id)throw new Error('Veículo não pertence ao cliente');
  if(order&&(Number(order.customer_id)!==customer.id||(machine&&Number(order.machine_id)!==machine.id)))throw new Error('OS não pertence ao cliente/veículo');
  const title=clean(input.title),notes=clean(input.notes),channel=clean(input.channel||'MANUAL').toUpperCase();
  if(!title||title.length>160||notes.length>2000)throw new Error('Título ou observações inválidos');
  if(!['MANUAL','TELEFONE','EMAIL','WHATSAPP'].includes(channel))throw new Error('Canal inválido');
  const dueAt=date(input.dueAt||nowIso().slice(0,10));
  const result=db.prepare("INSERT INTO crm_tasks(customer_id,machine_id,work_order_id,title,due_at,channel,notes,created_at) VALUES(?,?,?,?,?,?,?,?)").run(customer.id,machine?.id??null,order?.id??null,title,dueAt,channel,notes,nowIso());
  return db.prepare('SELECT * FROM crm_tasks WHERE id=?').get(Number(result.lastInsertRowid));
 });
}
export function listCrmTasks(db,{status='PENDENTE',limit=200}={}){
 if(!['PENDENTE','CONCLUIDA','TODAS'].includes(status))throw new Error('Situação CRM inválida');
 const n=Math.min(500,Math.max(1,Number(limit)||200));
 return db.prepare("SELECT t.*,c.name customer_name,c.phone customer_phone,c.email customer_email,m.license_plate,m.model machine_model FROM crm_tasks t JOIN customers c ON c.id=t.customer_id LEFT JOIN machines m ON m.id=t.machine_id WHERE (?='TODAS' OR t.status=?) ORDER BY t.due_at ASC,t.id DESC LIMIT ?").all(status,status,n);
}
export function completeCrmTask(db,id,{outcome}={}){
 const result=clean(outcome);
 if(!result||result.length>1000)throw new Error('Informe o resultado do contato (até 1000 caracteres)');
 const row=requireRow(db,'crm_tasks',id,'Tarefa CRM');
 if(row.status==='CONCLUIDA')return row;
 db.prepare("UPDATE crm_tasks SET status='CONCLUIDA',outcome=?,completed_at=? WHERE id=? AND status='PENDENTE'").run(result,nowIso(),row.id);
 return db.prepare('SELECT * FROM crm_tasks WHERE id=?').get(row.id);
}
export function createMaintenanceCrmTasks(db,{daysAhead=7}={}){
 const days=Number(daysAhead);
 if(!Number.isInteger(days)||days<0||days>90)throw new Error('Janela de manutenção inválida');
 const deadline=new Date(Date.now()+days*86400000).toISOString().slice(0,10);
 const plans=db.prepare("SELECT p.*,m.customer_id,m.model,m.license_plate,m.odometer_km,m.hour_meter FROM maintenance_plans p JOIN machines m ON m.id=p.machine_id WHERE p.active=1 AND ((p.next_due_date IS NOT NULL AND p.next_due_date<=?) OR (p.next_due_km IS NOT NULL AND m.odometer_km>=p.next_due_km) OR (p.next_due_hours IS NOT NULL AND m.hour_meter>=p.next_due_hours))").all(deadline);
 return transaction(db,()=>{
  let created=0;
  for(const p of plans){
   const due=p.next_due_date&&p.next_due_date<=deadline?p.next_due_date:nowIso().slice(0,10);
   const key='MAINT:'+p.id+':'+[p.next_due_date,p.next_due_km,p.next_due_hours].join(':');
   const r=db.prepare("INSERT OR IGNORE INTO crm_tasks(customer_id,machine_id,title,due_at,channel,notes,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?)").run(p.customer_id,p.machine_id,'Revisão: '+p.name,due,'MANUAL','Conferir manutenção preventiva antes de contatar o cliente.',key,nowIso());
   created+=r.changes;
  }
  return {created,duePlans:plans.length};
 });
}
export function createShopUnit(db,{code,name}={}){
 const c=clean(code).toUpperCase(),n=clean(name);
 if(!/^[A-Z0-9_-]{2,32}$/.test(c)||!n||n.length>120)throw new Error('Código ou nome da unidade inválido');
 const result=db.prepare('INSERT INTO shop_units(code,name,created_at) VALUES(?,?,?)').run(c,n,nowIso());
 return db.prepare('SELECT * FROM shop_units WHERE id=?').get(Number(result.lastInsertRowid));
}
export function listShopUnits(db){return db.prepare('SELECT * FROM shop_units ORDER BY id').all();}
export function assignWorkOrderUnit(db,workOrderId,unitId){
 const order=requireRow(db,'work_orders',workOrderId,'OS'),unit=requireRow(db,'shop_units',unitId,'Unidade');
 if(!unit.active)throw new Error('Unidade inativa');
 db.prepare('UPDATE work_orders SET unit_id=?,updated_at=? WHERE id=?').run(unit.id,nowIso(),order.id);
 return db.prepare('SELECT * FROM work_orders WHERE id=?').get(order.id);
}
export function unitReport(db){
 return db.prepare("SELECT u.id,u.code,u.name,COUNT(w.id) work_orders,SUM(CASE WHEN w.status='ENTREGUE' THEN 1 ELSE 0 END) delivered,COALESCE(SUM(w.quote_total_cents),0) quoted_cents FROM shop_units u LEFT JOIN work_orders w ON w.unit_id=u.id GROUP BY u.id ORDER BY u.id").all();
}
export function createFleet(db,{customerId,name}={}){
 const customer=requireRow(db,'customers',customerId,'Cliente'),n=clean(name);
 if(!n||n.length>120)throw new Error('Nome da frota inválido');
 const r=db.prepare('INSERT INTO fleets(customer_id,name,created_at) VALUES(?,?,?)').run(customer.id,n,nowIso());
 return db.prepare('SELECT * FROM fleets WHERE id=?').get(Number(r.lastInsertRowid));
}
export function addFleetVehicle(db,fleetId,machineId){
 const fleet=requireRow(db,'fleets',fleetId,'Frota'),vehicle=requireRow(db,'machines',machineId,'Veículo');
 if(Number(vehicle.customer_id)!==Number(fleet.customer_id))throw new Error('Veículo não pertence ao cliente da frota');
 db.prepare('INSERT OR IGNORE INTO fleet_vehicles(fleet_id,machine_id,created_at) VALUES(?,?,?)').run(fleet.id,vehicle.id,nowIso());
 return {ok:true};
}
export function listFleets(db){
 return db.prepare('SELECT f.*,c.name customer_name,COUNT(v.machine_id) vehicle_count FROM fleets f JOIN customers c ON c.id=f.customer_id LEFT JOIN fleet_vehicles v ON v.fleet_id=f.id GROUP BY f.id ORDER BY f.id DESC').all();
}
export function createTechnicalReference(db,{partId,manufacturer='',oemCode='',referenceCode='',notes=''}={}){
 const part=requireRow(db,'parts',partId,'Peça'),maker=clean(manufacturer),oem=clean(oemCode),reference=clean(referenceCode),note=clean(notes);
 if((!oem&&!reference)||maker.length>120||oem.length>120||reference.length>120||note.length>500)throw new Error('Referência técnica inválida');
 const r=db.prepare('INSERT INTO technical_references(part_id,manufacturer,oem_code,reference_code,notes,created_at) VALUES(?,?,?,?,?,?)').run(part.id,maker,oem,reference,note,nowIso());
 return db.prepare('SELECT * FROM technical_references WHERE id=?').get(Number(r.lastInsertRowid));
}
export function listTechnicalReferences(db,{partId}={}){
 if(partId!=null)requireRow(db,'parts',partId,'Peça');
 return partId==null
 ?db.prepare('SELECT t.*,p.description part_description,p.sku FROM technical_references t JOIN parts p ON p.id=t.part_id ORDER BY t.id DESC LIMIT 300').all()
 :db.prepare('SELECT t.*,p.description part_description,p.sku FROM technical_references t JOIN parts p ON p.id=t.part_id WHERE t.part_id=? ORDER BY t.id DESC').all(Number(partId));
}
function quoteDigest(quote){return sha(JSON.stringify([quote.id,quote.work_order_id,quote.total_cents,quote.updated_at,quote.items.map(i=>[i.id,i.kind,i.description,i.quantity,i.unit_price_cents,i.total_cents])]));}
function approvalRow(db,token){
 const t=clean(token);
 if(!/^[a-f0-9]{64}$/.test(t))throw new Error('Link de aprovação inválido');
 const row=db.prepare('SELECT * FROM quote_approval_links WHERE token_hash=?').get(sha(t));
 if(!row)throw new Error('Link de aprovação não encontrado');
 return row;
}
export function createApprovalLink(db,workOrderId,{expiresInHours=48}={}){
 const hours=Number(expiresInHours);
 if(!Number.isInteger(hours)||hours<1||hours>168)throw new Error('Prazo de aprovação inválido');
 return transaction(db,()=>{
  const quote=getQuote(db,workOrderId);
  if(quote.approval_status!=='AGUARDANDO')throw new Error('Orçamento não aguarda aprovação');
  if(quote.valid_until&&quote.valid_until<nowIso().slice(0,10))throw new Error('Orçamento vencido');
  const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+hours*3600000).toISOString();
  db.prepare("UPDATE quote_approval_links SET status='REVOGADO' WHERE work_order_id=? AND status='ATIVO'").run(Number(workOrderId));
  db.prepare("INSERT INTO quote_approval_links(work_order_id,token_hash,quote_digest,expires_at,created_at) VALUES(?,?,?,?,?)").run(Number(workOrderId),sha(token),quoteDigest(quote),expiresAt,nowIso());
  return {token,expiresAt,path:'/approval.html?token='+token};
 });
}
export function getApprovalProposal(db,token){
 const row=approvalRow(db,token);
 if(row.status==='REVOGADO')throw new Error('Link de aprovação revogado');
 if(row.status==='ATIVO'&&row.expires_at<=nowIso())throw new Error('Link de aprovação expirado');
 const quote=getQuote(db,row.work_order_id);
 if(row.status==='ATIVO'&&(quote.approval_status!=='AGUARDANDO'||quoteDigest(quote)!==row.quote_digest))throw new Error('Orçamento alterado: solicite novo link');
 return {status:row.status,totalCents:quote.total_cents,validUntil:quote.valid_until,expiresAt:row.expires_at,items:quote.items.map(i=>({kind:i.kind,description:i.description,quantity:i.quantity,totalCents:i.total_cents})),workOrderNumber:db.prepare('SELECT os_number FROM work_orders WHERE id=?').get(row.work_order_id).os_number};
}
export function resolveApproval(db,token,{decision,reason}={}){
 const d=clean(decision).toUpperCase(),why=clean(reason);
 if(!['APROVAR','REJEITAR'].includes(d))throw new Error('Decisão inválida');
 if(d==='REJEITAR'&&(!why||why.length>500))throw new Error('Informe o motivo da reprovação');
 return transaction(db,()=>{
  const row=approvalRow(db,token),target=d==='APROVAR'?'APROVADO':'REJEITADO';
  if(row.status===target)return {status:target,workOrderId:row.work_order_id};
  if(row.status!=='ATIVO')throw new Error('Link já utilizado ou revogado');
  if(row.expires_at<=nowIso())throw new Error('Link de aprovação expirado');
  const quote=getQuote(db,row.work_order_id);
  if(quote.approval_status!=='AGUARDANDO'||quoteDigest(quote)!==row.quote_digest)throw new Error('Orçamento alterado: solicite novo link');
  if(quote.valid_until&&quote.valid_until<nowIso().slice(0,10))throw new Error('Orçamento vencido');
  if(d==='APROVAR')approveQuote(db,row.work_order_id);
  else rejectQuote(db,row.work_order_id,why);
  db.prepare("UPDATE quote_approval_links SET status=?,responded_at=? WHERE id=? AND status='ATIVO'").run(target,nowIso(),row.id);
  return {status:target,workOrderId:row.work_order_id};
 });
}
