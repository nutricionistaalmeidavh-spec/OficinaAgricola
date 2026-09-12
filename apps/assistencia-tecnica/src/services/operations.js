import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nowIso, transaction } from '../db.js';
import { getWorkOrder } from './work-orders.js';

const EVENT_TYPES=new Set(['DIAGNOSTICO','EXECUCAO','VISITA','PREVISAO_ENTREGA','RETORNO']);
const CHECKLIST_KINDS=new Set(['ENTRADA','ENTREGA','PERSONALIZADO']);
const RESPONSES=new Set(['OK','ATENCAO','NAO_SE_APLICA']);
const ATTACHMENT_CATEGORIES=new Set(['ENTRADA','DIAGNOSTICO','SERVICO','ENTREGA','OUTRO']);
const MIME_EXT=new Map([['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp'],['application/pdf','.pdf']]);
const text=(v)=>v==null?'':String(v).trim();

function ensureOptionalLink(db,table,id,label){if(id!=null&&!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))throw new Error(`${label} não encontrado`)}

export function createScheduleEvent(db,input){
  if(!EVENT_TYPES.has(input.type)) throw new Error('Tipo de evento inválido');
  if(!text(input.title)||!input.startsAt||Number.isNaN(new Date(input.startsAt).getTime())) throw new Error('Evento inválido');
  ensureOptionalLink(db,'customers',input.customerId,'Cliente'); ensureOptionalLink(db,'machines',input.machineId,'Máquina'); ensureOptionalLink(db,'work_orders',input.workOrderId,'OS'); ensureOptionalLink(db,'technicians',input.technicianId,'Técnico');
  const t=nowIso(); const r=db.prepare(`INSERT INTO schedule_events(type,title,starts_at,ends_at,customer_id,machine_id,work_order_id,technician_id,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.type,text(input.title),new Date(input.startsAt).toISOString(),input.endsAt?new Date(input.endsAt).toISOString():null,input.customerId??null,input.machineId??null,input.workOrderId??null,input.technicianId??null,text(input.notes),t,t);
  return db.prepare('SELECT * FROM schedule_events WHERE id=?').get(Number(r.lastInsertRowid));
}
export function listSchedule(db,{from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z'}={}){
  return db.prepare(`SELECT e.*,c.name customer_name,m.model machine_model,t.name technician_name,wo.os_number FROM schedule_events e LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN machines m ON m.id=e.machine_id LEFT JOIN technicians t ON t.id=e.technician_id LEFT JOIN work_orders wo ON wo.id=e.work_order_id WHERE e.starts_at>=? AND e.starts_at<=? ORDER BY e.starts_at`).all(from,to);
}
export function updateScheduleEvent(db,id,input){
  const old=db.prepare('SELECT * FROM schedule_events WHERE id=?').get(id); if(!old)throw new Error('Evento não encontrado');
  const type=input.type??old.type; if(!EVENT_TYPES.has(type))throw new Error('Tipo de evento inválido');
  db.prepare(`UPDATE schedule_events SET type=?,title=?,starts_at=?,ends_at=?,customer_id=?,machine_id=?,work_order_id=?,technician_id=?,notes=?,updated_at=? WHERE id=?`).run(
    type,input.title===undefined?old.title:text(input.title),input.startsAt===undefined?old.starts_at:new Date(input.startsAt).toISOString(),input.endsAt===undefined?old.ends_at:(input.endsAt?new Date(input.endsAt).toISOString():null),
    input.customerId===undefined?old.customer_id:input.customerId,input.machineId===undefined?old.machine_id:input.machineId,input.workOrderId===undefined?old.work_order_id:input.workOrderId,input.technicianId===undefined?old.technician_id:input.technicianId,input.notes===undefined?old.notes:text(input.notes),nowIso(),id);
  return db.prepare('SELECT * FROM schedule_events WHERE id=?').get(id);
}

export function createChecklistTemplate(db,{name,kind='PERSONALIZADO',items=[]}){
  const cleanName=text(name); if(!cleanName||!CHECKLIST_KINDS.has(kind)||!Array.isArray(items)||items.length===0)throw new Error('Modelo de checklist inválido');
  return transaction(db,()=>{
    const t=nowIso(); const r=db.prepare('INSERT INTO checklist_templates(name,kind,created_at,updated_at) VALUES(?,?,?,?)').run(cleanName,kind,t,t); const id=Number(r.lastInsertRowid);
    const ins=db.prepare('INSERT INTO checklist_template_items(template_id,position,label) VALUES(?,?,?)');
    items.forEach((item,index)=>{const label=text(item);if(!label)throw new Error('Item de checklist vazio');ins.run(id,index+1,label)});
    return getChecklistTemplate(db,id);
  });
}
export function getChecklistTemplate(db,id){
  const t=db.prepare('SELECT * FROM checklist_templates WHERE id=?').get(id); if(!t)throw new Error('Modelo de checklist não encontrado');
  return {...t,items:db.prepare('SELECT * FROM checklist_template_items WHERE template_id=? ORDER BY position').all(id)};
}
export function listChecklistTemplates(db){return db.prepare('SELECT * FROM checklist_templates WHERE active=1 ORDER BY kind,name').all()}
export function seedDefaultChecklists(db){
  const existing=db.prepare("SELECT COUNT(*) n FROM checklist_templates WHERE kind IN ('ENTRADA','ENTREGA')").get().n; if(existing>=2)return;
  if(!db.prepare("SELECT id FROM checklist_templates WHERE kind='ENTRADA'").get())createChecklistTemplate(db,{name:'Checklist de Entrada',kind:'ENTRADA',items:['Fotos gerais da máquina','Nível de combustível','Horímetro registrado','Avarias externas','Itens/acessórios entregues']});
  if(!db.prepare("SELECT id FROM checklist_templates WHERE kind='ENTREGA'").get())createChecklistTemplate(db,{name:'Checklist de Entrega',kind:'ENTREGA',items:['Serviço conferido','Vazamentos verificados','Teste funcional','Limpeza básica','Orientações ao cliente']});
}
export function createWorkOrderChecklist(db,workOrderId,templateId,responses=[]){
  getWorkOrder(db,workOrderId); const template=getChecklistTemplate(db,templateId); const byPos=new Map(template.items.map(i=>[Number(i.position),i]));
  return transaction(db,()=>{
    const t=nowIso(); const r=db.prepare('INSERT INTO work_order_checklists(work_order_id,template_id,template_name_snapshot,created_at) VALUES(?,?,?,?)').run(workOrderId,templateId,template.name,t); const id=Number(r.lastInsertRowid);
    const ins=db.prepare('INSERT INTO checklist_responses(checklist_id,position,label_snapshot,response,note) VALUES(?,?,?,?,?)');
    const seen=new Set(); for(const response of responses){const pos=Number(response.position);const item=byPos.get(pos);if(!item)throw new Error('Item de checklist inválido');if(seen.has(pos))throw new Error('Resposta duplicada');seen.add(pos);if(!RESPONSES.has(response.response))throw new Error('Resposta inválida');ins.run(id,pos,item.label,response.response,text(response.note));}
    if(responses.length>0)db.prepare('UPDATE work_order_checklists SET completed_at=? WHERE id=?').run(t,id);
    return getWorkOrderChecklist(db,id);
  });
}
export function getWorkOrderChecklist(db,id){const c=db.prepare('SELECT * FROM work_order_checklists WHERE id=?').get(id);if(!c)throw new Error('Checklist não encontrado');return {...c,responses:db.prepare('SELECT * FROM checklist_responses WHERE checklist_id=? ORDER BY position').all(id)}}
export function listWorkOrderChecklists(db,workOrderId){return db.prepare('SELECT * FROM work_order_checklists WHERE work_order_id=? ORDER BY id DESC').all(workOrderId)}

export function saveAttachment(db,workOrderId,input){
  getWorkOrder(db,workOrderId); if(!ATTACHMENT_CATEGORIES.has(input.category))throw new Error('Categoria de anexo inválida');
  const ext=MIME_EXT.get(input.mimeType); if(!ext)throw new Error('Tipo de arquivo não permitido');
  const raw=Buffer.from(String(input.base64||''),'base64'); const maxBytes=Number(input.maxBytes??5*1024*1024); if(raw.length===0)throw new Error('Arquivo vazio'); if(raw.length>maxBytes)throw new Error('Arquivo excede o limite permitido');
  const root=resolve(input.storageDir||process.env.STORAGE_DIR||'./storage/uploads'); const targetDir=join(root,String(workOrderId)); mkdirSync(targetDir,{recursive:true});
  const filename=`${randomUUID()}${ext}`; const full=join(targetDir,filename); writeFileSync(full,raw,{flag:'wx'}); const rel=relative(root,full).replaceAll('\\','/'); if(rel.startsWith('..'))throw new Error('Caminho de armazenamento inválido');
  const r=db.prepare(`INSERT INTO attachments(work_order_id,category,caption,mime_type,original_name,relative_path,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(workOrderId,input.category,text(input.caption),input.mimeType,text(input.originalName)||`anexo${ext}`,rel,raw.length,nowIso());
  return db.prepare('SELECT * FROM attachments WHERE id=?').get(Number(r.lastInsertRowid));
}
export function listAttachments(db,workOrderId){return db.prepare('SELECT * FROM attachments WHERE work_order_id=? ORDER BY id DESC').all(workOrderId)}
