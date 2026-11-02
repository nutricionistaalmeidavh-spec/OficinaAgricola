import { nowIso, transaction } from '../db.js';
import { assertTransition } from '../domain.js';

const text=(v)=>v==null?'':String(v).trim();
const PRIORITIES=new Set(['BAIXA','NORMAL','ALTA','URGENTE']);
const customerSnapshot=c=>JSON.stringify({id:c.id,name:c.name,document:c.document,phone:c.phone,address:c.address});
const machineSnapshot=m=>JSON.stringify({id:m.id,type:m.type,brand:m.brand,model:m.model,year:m.year,serialNumber:m.serial_number,internalId:m.internal_id,hourMeter:m.hour_meter});
const auditValue=v=>v==null?null:String(v);

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
    const r=db.prepare(`INSERT INTO work_orders(os_number,customer_id,machine_id,entered_at,problem_reported,diagnosis,technician_id,estimated_delivery,priority,internal_notes,status,snapshot_customer,snapshot_machine,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(next,customer.id,machine.id,input.enteredAt??t,text(input.problemReported),text(input.diagnosis),input.technicianId??null,input.estimatedDelivery??null,priority,text(input.internalNotes),'ENTRADA',customerSnapshot(customer),machineSnapshot(machine),t,t);
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

export function updateWorkOrder(db,id,input,{changedBy=null}={}){
  const old=getWorkOrder(db,id);
  const customerId=input.customerId===undefined?old.customer_id:Number(input.customerId);
  const machineId=input.machineId===undefined?old.machine_id:Number(input.machineId);
  const customer=db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if(!customer) throw new Error('Cliente não encontrado');
  const machine=db.prepare('SELECT * FROM machines WHERE id=?').get(machineId);
  if(!machine) throw new Error('Máquina não encontrada');
  if(Number(machine.customer_id)!==Number(customer.id)) throw new Error('Máquina não pertence ao cliente selecionado');
  const technicianId=input.technicianId===undefined?old.technician_id:(input.technicianId||null);
  if(technicianId && !db.prepare('SELECT id FROM technicians WHERE id=?').get(technicianId)) throw new Error('Técnico não encontrado');
  const priority=input.priority??old.priority; if(!PRIORITIES.has(priority)) throw new Error('Prioridade inválida');
  const problemReported=input.problemReported===undefined?old.problem_reported:text(input.problemReported); if(!problemReported)throw new Error('Problema relatado é obrigatório');
  const next={
    customer_id:customerId,machine_id:machineId,entered_at:input.enteredAt===undefined?old.entered_at:input.enteredAt,
    problem_reported:problemReported,diagnosis:input.diagnosis===undefined?old.diagnosis:text(input.diagnosis),technician_id:technicianId,
    estimated_delivery:input.estimatedDelivery===undefined?old.estimated_delivery:(input.estimatedDelivery||null),priority,
    internal_notes:input.internalNotes===undefined?old.internal_notes:text(input.internalNotes)
  };
  const tracked=Object.keys(next); const t=nowIso();
  const nextCustomerSnapshot=Number(customerId)===Number(old.customer_id)?old.snapshot_customer:customerSnapshot(customer);
  const nextMachineSnapshot=Number(machineId)===Number(old.machine_id)?old.snapshot_machine:machineSnapshot(machine);
  return transaction(db,()=>{
    db.prepare(`UPDATE work_orders SET customer_id=?,machine_id=?,entered_at=?,problem_reported=?,diagnosis=?,technician_id=?,estimated_delivery=?,priority=?,internal_notes=?,snapshot_customer=?,snapshot_machine=?,updated_at=? WHERE id=?`).run(
      next.customer_id,next.machine_id,next.entered_at,next.problem_reported,next.diagnosis,next.technician_id,next.estimated_delivery,next.priority,next.internal_notes,
      nextCustomerSnapshot,nextMachineSnapshot,t,id);
    const insert=db.prepare('INSERT INTO work_order_change_history(work_order_id,field,old_value,new_value,changed_by,changed_at) VALUES(?,?,?,?,?,?)');
    for(const field of tracked){if(auditValue(old[field])!==auditValue(next[field]))insert.run(id,field,auditValue(old[field]),auditValue(next[field]),changedBy,t)}
    return getWorkOrder(db,id);
  });
}

export function duplicateWorkOrder(db,id,input={}){
  const old=getWorkOrder(db,id);
  return createWorkOrder(db,{
    customerId:input.customerId??old.customer_id,
    machineId:input.machineId??old.machine_id,
    problemReported:input.copyProblem===false?(text(input.problemReported)||'Serviço a definir'):old.problem_reported,
    diagnosis:input.copyDiagnosis?old.diagnosis:'',
    technicianId:input.copyTechnician===false?null:old.technician_id,
    priority:input.copyPriority===false?'NORMAL':old.priority,
    internalNotes:input.copyInternalNotes?old.internal_notes:'',
    estimatedDelivery:null,
    createdBy:input.createdBy??null
  });
}

// Única autoridade para mudanças de estado da OS; chamador mantém a transação.
export function transitionWorkOrderInTransaction(db,id,toStatus,{reason='',changedBy=null}={}){
  const old=getWorkOrder(db,id); assertTransition(old.status,toStatus); const t=nowIso();
  let completed=old.completed_at, delivered=old.delivered_at;
  if(toStatus==='PRONTA') completed=t;
  if(toStatus==='ENTREGUE') delivered=t;
  if(toStatus==='EM_SERVICO' && old.status==='PRONTA') completed=null;
  db.prepare('UPDATE work_orders SET status=?,completed_at=?,delivered_at=?,updated_at=? WHERE id=?').run(toStatus,completed,delivered,t,id);
  db.prepare(`INSERT INTO work_order_status_history(work_order_id,from_status,to_status,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?)`).run(id,old.status,toStatus,text(reason),changedBy,t);
  return getWorkOrder(db,id);
}
export function transitionWorkOrder(db,id,toStatus,options={}){
  return transaction(db,()=>transitionWorkOrderInTransaction(db,id,toStatus,options));
}

export function getWorkOrderHistory(db,id){
  getWorkOrder(db,id);
  return db.prepare(`
    SELECT 'STATUS' type,h.id source_id,NULL field,h.from_status old_value,h.to_status new_value,h.reason,h.changed_by,u.name changed_by_name,h.changed_at
    FROM work_order_status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.work_order_id=?
    UNION ALL
    SELECT 'FIELD_CHANGE' type,c.id source_id,c.field,c.old_value,c.new_value,'' reason,c.changed_by,u.name changed_by_name,c.changed_at
    FROM work_order_change_history c LEFT JOIN users u ON u.id=c.changed_by WHERE c.work_order_id=?
    ORDER BY changed_at, type, source_id`).all(id,id);
}
export function machineHistory(db,machineId){
  return db.prepare(`SELECT wo.id,wo.os_number,wo.status,wo.entered_at,wo.completed_at,wo.delivered_at,wo.problem_reported,wo.diagnosis,wo.quote_total_cents,t.name technician_name
    FROM work_orders wo LEFT JOIN technicians t ON t.id=wo.technician_id WHERE wo.machine_id=? ORDER BY wo.id DESC`).all(machineId);
}
