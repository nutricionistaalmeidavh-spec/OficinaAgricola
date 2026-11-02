import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nowIso, transaction } from '../db.js';
import { getWorkOrder } from './work-orders.js';
import {runIdempotent} from '../platform/idempotency.js';

const EVENT_TYPES=new Set(['DIAGNOSTICO','EXECUCAO','VISITA','PREVISAO_ENTREGA','RETORNO']);
const CHECKLIST_KINDS=new Set(['ENTRADA','ENTREGA','PERSONALIZADO']);
const RESPONSES=new Set(['OK','ATENCAO','NAO_SE_APLICA']);
const ATTACHMENT_CATEGORIES=new Set(['ENTRADA','DIAGNOSTICO','SERVICO','ENTREGA','OUTRO']);
const MIME_EXT=new Map([['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp'],['application/pdf','.pdf']]);
const text=(v)=>v==null?'':String(v).trim();

function ensureOptionalLink(db,table,id,label){if(id!=null&&id!==''&&!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))throw new Error(`${label} não encontrado`)}
function validateScheduleLinks(db,{customerId,machineId,workOrderId,technicianId,startsAt,endsAt}){
  ensureOptionalLink(db,'customers',customerId,'Cliente');
  ensureOptionalLink(db,'machines',machineId,'Equipamento');
  ensureOptionalLink(db,'work_orders',workOrderId,'OS');
  ensureOptionalLink(db,'technicians',technicianId,'Técnico');
  const start=new Date(startsAt);
  if(!startsAt||Number.isNaN(start.getTime()))throw new Error('Data de início inválida');
  if(endsAt!=null&&endsAt!==''){
    const end=new Date(endsAt);
    if(Number.isNaN(end.getTime()))throw new Error('Data final inválida');
    if(end<start)throw new Error('Data final anterior ao início');
  }
  const machine=machineId?db.prepare('SELECT customer_id FROM machines WHERE id=?').get(machineId):null;
  const order=workOrderId?db.prepare('SELECT customer_id,machine_id FROM work_orders WHERE id=?').get(workOrderId):null;
  if(machine&&customerId&&Number(machine.customer_id)!==Number(customerId))
    throw new Error('Equipamento não pertence ao cliente selecionado');
  if(order&&customerId&&Number(order.customer_id)!==Number(customerId))
    throw new Error('OS não pertence ao cliente selecionado');
  if(order&&machineId&&Number(order.machine_id)!==Number(machineId))
    throw new Error('OS não pertence ao equipamento selecionado');
}

export function createScheduleEvent(db,input){
  const {requestId,...command}=input;
  return runIdempotent(db,'schedule:create',requestId,command,()=>{
    if(!EVENT_TYPES.has(command.type)||!text(command.title))throw new Error('Evento inválido');
    validateScheduleLinks(db,command);
    const t=nowIso();
    const r=db.prepare(`INSERT INTO schedule_events(type,title,starts_at,ends_at,customer_id,machine_id,work_order_id,technician_id,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(command.type,text(command.title),new Date(command.startsAt).toISOString(),
        command.endsAt?new Date(command.endsAt).toISOString():null,command.customerId||null,
        command.machineId||null,command.workOrderId||null,command.technicianId||null,text(command.notes),t,t);
    return db.prepare('SELECT * FROM schedule_events WHERE id=?').get(Number(r.lastInsertRowid));
  });
}
export function listSchedule(db,{from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z'}={}){
  return db.prepare(`SELECT e.*,c.name customer_name,m.model machine_model,t.name technician_name,wo.os_number FROM schedule_events e LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN machines m ON m.id=e.machine_id LEFT JOIN technicians t ON t.id=e.technician_id LEFT JOIN work_orders wo ON wo.id=e.work_order_id WHERE e.starts_at>=? AND e.starts_at<=? ORDER BY e.starts_at`).all(from,to);
}
export function updateScheduleEvent(db,id,input){
  return transaction(db,()=>{
    const old=db.prepare('SELECT * FROM schedule_events WHERE id=?').get(id);
    if(!old)throw new Error('Evento não encontrado');
    const next={
      type:input.type??old.type,title:input.title===undefined?old.title:text(input.title),
      startsAt:input.startsAt===undefined?old.starts_at:input.startsAt,
      endsAt:input.endsAt===undefined?old.ends_at:input.endsAt,
      customerId:input.customerId===undefined?old.customer_id:input.customerId,
      machineId:input.machineId===undefined?old.machine_id:input.machineId,
      workOrderId:input.workOrderId===undefined?old.work_order_id:input.workOrderId,
      technicianId:input.technicianId===undefined?old.technician_id:input.technicianId,
      notes:input.notes===undefined?old.notes:text(input.notes)
    };
    if(!EVENT_TYPES.has(next.type)||!text(next.title))throw new Error('Evento inválido');
    validateScheduleLinks(db,next);
    db.prepare(`UPDATE schedule_events SET type=?,title=?,starts_at=?,ends_at=?,customer_id=?,machine_id=?,work_order_id=?,technician_id=?,notes=?,updated_at=? WHERE id=?`)
      .run(next.type,next.title,new Date(next.startsAt).toISOString(),
        next.endsAt?new Date(next.endsAt).toISOString():null,next.customerId||null,
        next.machineId||null,next.workOrderId||null,next.technicianId||null,next.notes,nowIso(),id);
    return db.prepare('SELECT * FROM schedule_events WHERE id=?').get(id);
  });
}

export function createChecklistTemplate(db,{name,kind='PERSONALIZADO',items=[]}){
  const cleanName=text(name); if(!cleanName||!CHECKLIST_KINDS.has(kind)||!Array.isArray(items)||items.length===0)throw new Error('Modelo de checklist inválido');
  return transaction(db,()=>{
    const t=nowIso(); const r=db.prepare('INSERT INTO checklist_templates(name,kind,created_at,updated_at) VALUES(?,?,?,?)').run(cleanName,kind,t,t); const id=Number(r.lastInsertRowid);
    const ins=db.prepare('INSERT INTO checklist_template_items(template_id,position,label,required) VALUES(?,?,?,?)');
    items.forEach((item,index)=>{
      const label=text(typeof item==='object'?item.label:item);
      if(!label)throw new Error('Item de checklist vazio');
      ins.run(id,index+1,label,typeof item==='object'&&item.required===false?0:1);
    });
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
export function createWorkOrderChecklist(db,workOrderId,templateId,responses=[],options={}){
  const requestId=options.requestId??null;
  return runIdempotent(db,`work-order:${workOrderId}:checklist`,requestId,
    {templateId,responses},()=>{
    getWorkOrder(db,workOrderId);
    const template=getChecklistTemplate(db,templateId);
    const byPos=new Map(template.items.map(i=>[Number(i.position),i]));
    if(!Array.isArray(responses))throw new Error('Respostas inválidas');
    const t=nowIso();
    const r=db.prepare('INSERT INTO work_order_checklists(work_order_id,template_id,template_name_snapshot,created_at) VALUES(?,?,?,?)')
      .run(workOrderId,templateId,template.name,t);
    const id=Number(r.lastInsertRowid);
    const ins=db.prepare('INSERT INTO checklist_responses(checklist_id,position,label_snapshot,response,note) VALUES(?,?,?,?,?)');
    const seen=new Set();
    for(const response of responses){
      const pos=Number(response.position),item=byPos.get(pos);
      if(!item)throw new Error('Item de checklist inválido');
      if(seen.has(pos))throw new Error('Resposta duplicada');
      seen.add(pos);
      if(!RESPONSES.has(response.response))throw new Error('Resposta inválida');
      ins.run(id,pos,item.label,response.response,text(response.note));
    }
    // Projeção de conclusão: nenhum item obrigatório pode ficar sem resposta.
    const complete=template.items.every(item=>!item.required||seen.has(Number(item.position)));
    if(complete&&seen.size>0)
      db.prepare('UPDATE work_order_checklists SET completed_at=? WHERE id=?').run(t,id);
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
