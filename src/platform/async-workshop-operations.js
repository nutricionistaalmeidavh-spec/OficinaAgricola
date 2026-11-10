import {randomBytes} from 'node:crypto';
const nextId=()=>randomBytes(6).readUIntBE(0,6);
const clean=v=>String(v??'').trim();
const int=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n;};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const now=()=>new Date().toISOString();
const EVENT_TYPES=new Set(['DIAGNOSTICO','EXECUCAO','VISITA','PREVISAO_ENTREGA','RETORNO']);
const KINDS=new Set(['ENTRADA','ENTREGA','PERSONALIZADO']);
const ANSWERS=new Set(['OK','ATENCAO','NAO_SE_APLICA']);
const cmd=(sql,params=[])=>({sql,params});
async function atomic(port,statements){
 if(port.engine==='d1')return port.batch(statements);
 return port.transaction(async tx=>{
   const output=[];for(const s of statements)output.push(await tx.run(s.sql,s.params));
   return output;
 });
}
export function createAsyncWorkshopOperations(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function checkSchedule(input){
   const start=new Date(input.startsAt);
   if(!input.startsAt||Number.isNaN(start.getTime()))fail('Data de início inválida');
   const end=input.endsAt?new Date(input.endsAt):null;
   if(end&&Number.isNaN(end.getTime()))fail('Data final inválida');
   if(end&&end<start)fail('Data final anterior ao início');
   for(const [column,table,label] of [
     ['customerId','customers','Cliente'],['machineId','machines','Equipamento'],
     ['workOrderId','work_orders','OS'],['technicianId','technicians','Técnico']
   ]){
     if(input[column]!=null&&!await port.first('SELECT id FROM '+table+' WHERE id=?',[int(input[column])]))
       fail(label+' não encontrado',404);
   }
   const machine=input.machineId?await port.first(
     'SELECT customer_id FROM machines WHERE id=?',[int(input.machineId)]):null;
   const order=input.workOrderId?await port.first(
     'SELECT customer_id,machine_id FROM work_orders WHERE id=?',[int(input.workOrderId)]):null;
   if(machine&&input.customerId&&Number(machine.customer_id)!==Number(input.customerId))
     fail('Equipamento não pertence ao cliente');
   if(order&&input.customerId&&Number(order.customer_id)!==Number(input.customerId))
     fail('OS não pertence ao cliente');
   if(order&&input.machineId&&Number(order.machine_id)!==Number(input.machineId))
     fail('OS não pertence ao equipamento');
   return {startsAt:start.toISOString(),endsAt:end?.toISOString()??null};
 }
 async function createScheduleEvent(input={}){
   const type=clean(input.type),title=clean(input.title);
   if(!EVENT_TYPES.has(type)||!title)fail('Evento inválido');
   const dates=await checkSchedule(input),eventId=nextId(),at=now();
   await port.run(`INSERT INTO schedule_events(
     id,type,title,starts_at,ends_at,customer_id,machine_id,work_order_id,
     technician_id,notes,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[
     eventId,type,title,dates.startsAt,dates.endsAt,input.customerId||null,
     input.machineId||null,input.workOrderId||null,input.technicianId||null,
     clean(input.notes),at,at
   ]);
   return port.first('SELECT * FROM schedule_events WHERE id=?',[eventId]);
 }
 async function updateScheduleEvent(eventId,input={}){
   const old=await port.first('SELECT * FROM schedule_events WHERE id=?',[int(eventId)]);
   if(!old)fail('Evento não encontrado',404);
   const next={
     type:input.type??old.type,title:input.title??old.title,
     startsAt:input.startsAt??old.starts_at,endsAt:input.endsAt===undefined?old.ends_at:input.endsAt,
     customerId:input.customerId===undefined?old.customer_id:input.customerId,
     machineId:input.machineId===undefined?old.machine_id:input.machineId,
     workOrderId:input.workOrderId===undefined?old.work_order_id:input.workOrderId,
     technicianId:input.technicianId===undefined?old.technician_id:input.technicianId,
     notes:input.notes===undefined?old.notes:input.notes
   };
   const type=clean(next.type),title=clean(next.title);
   if(!EVENT_TYPES.has(type)||!title)fail('Evento inválido');
   const dates=await checkSchedule(next);
   await port.run(`UPDATE schedule_events SET
     type=?,title=?,starts_at=?,ends_at=?,customer_id=?,machine_id=?,work_order_id=?,
     technician_id=?,notes=?,updated_at=? WHERE id=?`,[
     type,title,dates.startsAt,dates.endsAt,next.customerId||null,next.machineId||null,
     next.workOrderId||null,next.technicianId||null,clean(next.notes),now(),old.id
   ]);
   return port.first('SELECT * FROM schedule_events WHERE id=?',[old.id]);
 }
 async function listSchedule({from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z',limit=100}={}){
   return port.all(`SELECT e.*,c.name customer_name,m.model machine_model,
     t.name technician_name,wo.os_number
     FROM schedule_events e LEFT JOIN customers c ON c.id=e.customer_id
     LEFT JOIN machines m ON m.id=e.machine_id
     LEFT JOIN technicians t ON t.id=e.technician_id
     LEFT JOIN work_orders wo ON wo.id=e.work_order_id
     WHERE e.starts_at>=? AND e.starts_at<=? ORDER BY e.starts_at,e.id LIMIT ?`,[
     from,to,Math.max(1,Math.min(500,Number(limit)||100))
   ]);
 }
 async function getChecklistTemplate(templateId){
   const row=await port.first('SELECT * FROM checklist_templates WHERE id=?',[int(templateId)]);
   if(!row)fail('Modelo de checklist não encontrado',404);
   return {...row,items:await port.all(
     'SELECT * FROM checklist_template_items WHERE template_id=? ORDER BY position',[row.id])};
 }
 async function listChecklistTemplates({includeInactive=false}={}){
   return port.all('SELECT * FROM checklist_templates '+(includeInactive?'':'WHERE active=1 ')+'ORDER BY kind,name');
 }
 async function updateChecklistTemplate(templateId,input={}){
   const previous=await getChecklistTemplate(templateId);
   const name=input.name===undefined?previous.name:clean(input.name);
   const kind=input.kind===undefined?previous.kind:clean(input.kind);
   const active=input.active===undefined?Number(previous.active):Number(input.active===true||input.active===1);
   const items=input.items===undefined?previous.items:input.items;
   if(!name||name.length>120||!KINDS.has(kind)||!Array.isArray(items)||!items.length||items.length>100)
     fail('Modelo de checklist inválido');
   const normalized=items.map((item,index)=>({
     id:nextId(),position:index+1,label:clean(typeof item==='string'?item:item?.label),
     required:typeof item==='object'&&item?.required===false?0:1
   }));
   if(normalized.some(item=>!item.label||item.label.length>240))fail('Item de checklist inválido');
   const id=int(templateId);
   const statements=[cmd('UPDATE checklist_templates SET name=?,kind=?,active=?,updated_at=? WHERE id=?',
     [name,kind,active,now(),id])];
   if(input.items!==undefined){
     statements.push(cmd('DELETE FROM checklist_template_items WHERE template_id=?',[id]));
     for(const item of normalized)statements.push(cmd(
       'INSERT INTO checklist_template_items(id,template_id,position,label,required) VALUES(?,?,?,?,?)',
       [item.id,id,item.position,item.label,item.required]));
   }
   await atomic(port,statements);
   return getChecklistTemplate(id);
 }
 async function createChecklistTemplate({name,kind='PERSONALIZADO',items=[]}={}){
   const title=clean(name);
   if(!title||!KINDS.has(kind)||!Array.isArray(items)||!items.length||items.length>100)
     fail('Modelo de checklist inválido');
   const normalized=items.map((item,i)=>({
     id:nextId(),position:i+1,label:clean(typeof item==='string'?item:item?.label),
     required:typeof item==='object'&&item?.required===false?0:1
   }));
   if(normalized.some(x=>!x.label))fail('Item de checklist vazio');
   const templateId=nextId(),at=now();
   const statements=[cmd(`INSERT INTO checklist_templates(
     id,name,kind,created_at,updated_at
   ) VALUES(?,?,?,?,?)`,[templateId,title,kind,at,at])];
   for(const item of normalized)statements.push(cmd(`INSERT INTO checklist_template_items(
     id,template_id,position,label,required
   ) VALUES(?,?,?,?,?)`,[item.id,templateId,item.position,item.label,item.required]));
   await atomic(port,statements);
   return getChecklistTemplate(templateId);
 }
 async function getWorkOrderChecklist(checklistId){
   const row=await port.first('SELECT * FROM work_order_checklists WHERE id=?',[int(checklistId)]);
   if(!row)fail('Checklist não encontrado',404);
   return {...row,responses:await port.all(
     'SELECT * FROM checklist_responses WHERE checklist_id=? ORDER BY position',[row.id])};
 }
 async function createWorkOrderChecklist({workOrderId,templateId,responses=[]}={}){
   const osId=int(workOrderId);
   if(!await port.first('SELECT id FROM work_orders WHERE id=?',[osId]))
     fail('OS não encontrada',404);
   const template=await getChecklistTemplate(templateId);
   if(!Array.isArray(responses)||responses.length>100)fail('Respostas inválidas');
   const byPos=new Map(template.items.map(i=>[Number(i.position),i]));
   const seen=new Set(),cleaned=[];
   for(const response of responses){
     const position=Number(response?.position),item=byPos.get(position);
     if(!item)fail('Item de checklist inválido');
     if(seen.has(position))fail('Resposta duplicada');
     if(!ANSWERS.has(response?.response))fail('Resposta inválida');
     seen.add(position);
     cleaned.push({id:nextId(),position,label:item.label,response:response.response,
       note:clean(response.note)});
   }
   const complete=cleaned.length>0&&template.items.every(item=>
     !item.required||seen.has(Number(item.position)));
   const checklistId=nextId(),at=now();
   const statements=[cmd(`INSERT INTO work_order_checklists(
     id,work_order_id,template_id,template_name_snapshot,completed_at,created_at
   ) VALUES(?,?,?,?,?,?)`,[
     checklistId,osId,template.id,template.name,complete?at:null,at
   ])];
   for(const response of cleaned)statements.push(cmd(`INSERT INTO checklist_responses(
     id,checklist_id,position,label_snapshot,response,note
   ) VALUES(?,?,?,?,?,?)`,[
     response.id,checklistId,response.position,response.label,response.response,response.note
   ]));
   await atomic(port,statements);
   return getWorkOrderChecklist(checklistId);
 }
 async function listWorkOrderChecklists(workOrderId){
   return port.all('SELECT * FROM work_order_checklists WHERE work_order_id=? ORDER BY id DESC',
     [int(workOrderId)]);
 }
 return Object.freeze({
   createScheduleEvent,updateScheduleEvent,listSchedule,
   createChecklistTemplate,getChecklistTemplate,listChecklistTemplates,updateChecklistTemplate,
   createWorkOrderChecklist,getWorkOrderChecklist,listWorkOrderChecklists
 });
}
