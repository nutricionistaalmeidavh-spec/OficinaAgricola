import { nowIso, transaction } from '../db.js';
import { assertTransition } from '../domain.js';

const text=(v)=>v==null?'':String(v).trim();
const PRIORITIES=new Set(['BAIXA','NORMAL','ALTA','URGENTE']);

export function createWorkOrder(db,input){
  if(!text(input.problemReported)) throw new Error('Problema relatado é obrigatório');
  const customer=db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(input.customerId);
  if(!customer) throw new Error('Cliente não encontrado');
  const machine=db.prepare('SELECT * FROM machines WHERE id=? AND active=1').get(input.machineId);
  if(!machine) throw new Error('Máquina não encontrada');
  if(Number(machine.customer_id)!==Number(customer.id)) throw new Error('Máquina não pertence ao cliente selecionado');
  if(input.technicianId && !db.prepare('SELECT id FROM technicians WHERE id=? AND active=1').get(input.technicianId)) throw new Error('Técnico não encontrado');
  const priority=input.priority??'NORMAL'; if(!PRIORITIES.has(priority)) throw new Error('Prioridade inválida');
  return transaction(db,()=>{
    const next=Number(db.prepare('SELECT COALESCE(MAX(os_number),0)+1 next FROM work_orders').get().next);
    const t=nowIso();
    const customerSnapshot=JSON.stringify({id:customer.id,name:customer.name,document:customer.document,phone:customer.phone,address:customer.address});
    const machineSnapshot=JSON.stringify({id:machine.id,type:machine.type,brand:machine.brand,model:machine.model,year:machine.year,serialNumber:machine.serial_number,internalId:machine.internal_id,hourMeter:machine.hour_meter});
    const r=db.prepare(`INSERT INTO work_orders(os_number,customer_id,machine_id,entered_at,problem_reported,diagnosis,technician_id,estimated_delivery,priority,internal_notes,status,snapshot_customer,snapshot_machine,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(next,customer.id,machine.id,input.enteredAt??t,text(input.problemReported),text(input.diagnosis),input.technicianId??null,input.estimatedDelivery??null,priority,text(input.internalNotes),'ENTRADA',customerSnapshot,machineSnapshot,t,t);
    const id=Number(r.lastInsertRowid);
    db.prepare(`INSERT INTO work_order_status_history(work_order_id,from_status,to_status,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?)`).run(id,null,'ENTRADA','Abertura da OS',input.createdBy??null,t);
    return getWorkOrder(db,id);
  });
}

export function getWorkOrder(db,id){
  const row=db.prepare(`SELECT wo.*, c.name customer_name, m.type machine_type, m.brand machine_brand, m.model machine_model, t.name technician_name
    FROM work_orders wo JOIN customers c ON c.id=wo.customer_id JOIN machines m ON m.id=wo.machine_id LEFT JOIN technicians t ON t.id=wo.technician_id WHERE wo.id=?`).get(id);
  if(!row) throw new Error('Ordem de serviço não encontrada'); return row;
}
export function listWorkOrders(db,{status,search='',limit=200}={}){
  const clauses=[]; const params=[];
  if(status){clauses.push('wo.status=?');params.push(status)}
  if(search){const q=`%${text(search)}%`;clauses.push('(CAST(wo.os_number AS TEXT) LIKE ? OR c.name LIKE ? OR m.model LIKE ? OR wo.problem_reported LIKE ?)');params.push(q,q,q,q)}
  params.push(Math.min(Math.max(Number(limit)||200,1),1000));
  return db.prepare(`SELECT wo.*,c.name customer_name,m.type machine_type,m.brand machine_brand,m.model machine_model,t.name technician_name
    FROM work_orders wo JOIN customers c ON c.id=wo.customer_id JOIN machines m ON m.id=wo.machine_id LEFT JOIN technicians t ON t.id=wo.technician_id
    ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY wo.id DESC LIMIT ?`).all(...params);
}

export function updateWorkOrder(db,id,input){
  const old=getWorkOrder(db,id);
  if(['ENTREGUE','CANCELADA'].includes(old.status)) throw new Error('OS finalizada não pode ser alterada');
  const technicianId=input.technicianId===undefined?old.technician_id:input.technicianId;
  if(technicianId && !db.prepare('SELECT id FROM technicians WHERE id=? AND active=1').get(technicianId)) throw new Error('Técnico não encontrado');
  const priority=input.priority??old.priority; if(!PRIORITIES.has(priority)) throw new Error('Prioridade inválida');
  db.prepare(`UPDATE work_orders SET diagnosis=?,technician_id=?,estimated_delivery=?,priority=?,internal_notes=?,problem_reported=?,updated_at=? WHERE id=?`).run(
    input.diagnosis===undefined?old.diagnosis:text(input.diagnosis),technicianId,input.estimatedDelivery===undefined?old.estimated_delivery:input.estimatedDelivery,
    priority,input.internalNotes===undefined?old.internal_notes:text(input.internalNotes),input.problemReported===undefined?old.problem_reported:text(input.problemReported),nowIso(),id);
  return getWorkOrder(db,id);
}

export function transitionWorkOrder(db,id,toStatus,{reason='',changedBy=null}={}){
  return transaction(db,()=>{
    const old=getWorkOrder(db,id); assertTransition(old.status,toStatus); const t=nowIso();
    let completed=old.completed_at, delivered=old.delivered_at;
    if(toStatus==='PRONTA') completed=t;
    if(toStatus==='ENTREGUE') delivered=t;
    if(toStatus==='EM_SERVICO' && old.status==='PRONTA') completed=null;
    db.prepare('UPDATE work_orders SET status=?,completed_at=?,delivered_at=?,updated_at=? WHERE id=?').run(toStatus,completed,delivered,t,id);
    db.prepare(`INSERT INTO work_order_status_history(work_order_id,from_status,to_status,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?)`).run(id,old.status,toStatus,text(reason),changedBy,t);
    return getWorkOrder(db,id);
  });
}

export function getWorkOrderHistory(db,id){ getWorkOrder(db,id); return db.prepare('SELECT * FROM work_order_status_history WHERE work_order_id=? ORDER BY id').all(id); }
export function machineHistory(db,machineId){
  return db.prepare(`SELECT wo.id,wo.os_number,wo.status,wo.entered_at,wo.completed_at,wo.delivered_at,wo.problem_reported,wo.diagnosis,wo.quote_total_cents,t.name technician_name
    FROM work_orders wo LEFT JOIN technicians t ON t.id=wo.technician_id WHERE wo.machine_id=? ORDER BY wo.id DESC`).all(machineId);
}
