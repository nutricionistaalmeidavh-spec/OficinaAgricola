import {nowIso,transaction} from '../db.js';

function isoDate(value,label){
  if(value==null||value==='')return null;
  const s=String(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)
    throw new Error(`${label} inválida`);
  return s;
}
function distance(value){
  if(value==null||value==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw new Error('Quilometragem da próxima revisão inválida');
  return n;
}
export function listServiceRecords(db,machineId){
  if(!db.prepare('SELECT 1 FROM machines WHERE id=?').get(machineId))throw new Error('Veículo não encontrado');
  return db.prepare(`SELECT v.*, w.os_number
    FROM vehicle_maintenance_records v LEFT JOIN work_orders w ON w.id=v.work_order_id
    WHERE v.machine_id=? ORDER BY v.created_at DESC,v.id DESC`).all(machineId);
}
export function createServiceRecord(db,machineId,input){
  return transaction(db,()=>{
    if(!db.prepare('SELECT 1 FROM machines WHERE id=?').get(machineId))throw new Error('Veículo não encontrado');
    const kind=String(input?.kind||'');
    if(!['REVISAO','GARANTIA'].includes(kind))throw new Error('Tipo de revisão/garantia inválido');
    const workOrderId=input.workOrderId==null||input.workOrderId===''?null:Number(input.workOrderId);
    if(workOrderId!==null){
      const order=db.prepare('SELECT machine_id FROM work_orders WHERE id=?').get(workOrderId);
      if(!order||Number(order.machine_id)!==Number(machineId))
        throw new Error('OS não pertence a este veículo');
    }
    const performedAt=isoDate(input.performedAt,'Data da revisão');
    const nextDueDate=isoDate(input.nextDueDate,'Data da próxima revisão');
    const warrantyUntil=isoDate(input.warrantyUntil,'Validade da garantia');
    const nextDueKm=distance(input.nextDueKm);
    const notes=String(input.notes||'').trim();
    if(notes.length>2000)throw new Error('Observações excedem 2.000 caracteres');
    if(kind==='REVISAO'&&!performedAt)throw new Error('Informe a data da revisão');
    if(kind==='GARANTIA'&&!warrantyUntil)throw new Error('Informe a validade da garantia');
    const r=db.prepare(`INSERT INTO vehicle_maintenance_records(
      machine_id,work_order_id,kind,performed_at,next_due_date,next_due_km,
      warranty_until,notes,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      machineId,workOrderId,kind,performedAt,nextDueDate,nextDueKm,warrantyUntil,notes,nowIso()
    );
    return db.prepare('SELECT * FROM vehicle_maintenance_records WHERE id=?').get(Number(r.lastInsertRowid));
  });
}
