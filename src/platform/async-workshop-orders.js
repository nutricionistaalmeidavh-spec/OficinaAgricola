import {randomBytes} from 'node:crypto';
import {assertTransition} from '../domain.js';

const nextId=()=>randomBytes(6).readUIntBE(0,6);
const clean=v=>String(v??'').trim();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};
const count=result=>Number(result?.changes??result?.meta?.changes??0);
const now=()=>new Date().toISOString();
const command=(sql,params=[])=>({sql,params});
const PRIORITIES=new Set(['BAIXA','NORMAL','ALTA','URGENTE']);
const TERMINAL="('ENTREGUE','CANCELADA','REPROVADA','TRANSFERIDA')";
const stringify=value=>value==null?null:String(value);
export function createAsyncWorkshopOrders(port,{createWorkOrder,transitionWorkOrder,getWorkOrder}={}){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function fullOrder(osId){
   const row=await port.first(`SELECT wo.*,c.name customer_name,
     m.type machine_type,m.brand machine_brand,m.model machine_model,t.name technician_name
     FROM work_orders wo JOIN customers c ON c.id=wo.customer_id
     JOIN machines m ON m.id=wo.machine_id
     LEFT JOIN technicians t ON t.id=wo.technician_id WHERE wo.id=?`,[id(osId)]);
   if(!row)fail('Ordem de serviço não encontrada',404);
   return row;
 }
 const orderSelect=`SELECT wo.*,c.name customer_name,
   m.type machine_type,m.brand machine_brand,m.model machine_model,t.name technician_name
   FROM work_orders wo JOIN customers c ON c.id=wo.customer_id
   JOIN machines m ON m.id=wo.machine_id
   LEFT JOIN technicians t ON t.id=wo.technician_id`;
 const countSelect=`SELECT COUNT(*) n FROM work_orders wo
   JOIN customers c ON c.id=wo.customer_id JOIN machines m ON m.id=wo.machine_id`;
 function conditions({status='',scope='',search=''}={}){
   const filters=[],args=[];
   if(scope==='active')filters.push('wo.status NOT IN '+TERMINAL);
   else if(scope==='closed')filters.push('wo.status IN '+TERMINAL);
   if(status){filters.push('wo.status=?');args.push(status);}
   if(clean(search)){
     filters.push(`(CAST(wo.os_number AS TEXT) LIKE ? OR c.name LIKE ?
       OR m.model LIKE ? OR wo.problem_reported LIKE ?)`);
     const q='%'+clean(search)+'%';args.push(q,q,q,q);
   }
   return {filters,args};
 }
 async function listWorkOrders(options={}){
   const {filters,args}=conditions(options);
   const limit=Math.max(1,Math.min(1000,Number(options.limit)||200)),
     offset=Math.max(0,Math.min(1000000,Number(options.offset)||0));
   return port.all(orderSelect+(filters.length?' WHERE '+filters.join(' AND '):'')+
     ' ORDER BY wo.id DESC LIMIT ? OFFSET ?',[...args,limit,offset]);
 }
 async function listWorkOrdersPage(options={}){
   const {filters,args}=conditions(options),size=Math.max(1,Math.min(100,Number(options.limit)||60));
   const raw=options.cursor,next=raw==null||raw===''?null:id(raw);
   const where=filters.length?' WHERE '+filters.join(' AND '):'';
   const totals=await port.first(countSelect+where,args);
   const continuation=next==null?'':(filters.length?' AND ':' WHERE ')+'wo.id<?';
   const rows=await port.all(orderSelect+where+continuation+' ORDER BY wo.id DESC LIMIT ?',
     [...args,...(next==null?[]:[next]),size+1]);
   const hasMore=rows.length>size,items=hasMore?rows.slice(0,size):rows;
   return {items,total:Number(totals.n),nextCursor:hasMore?items.at(-1)?.id??null:null};
 }
 async function updateWorkOrder(workOrderId,input={}){
   const old=await fullOrder(workOrderId);
   if(old.status==='TRANSFERIDA')fail('OS transferida para outra unidade',409);
   if(!Number.isSafeInteger(Number(input.expectedVersion))||
     Number(input.expectedVersion)!==Number(old.version))fail('Conflito de versão: recarregue a OS',409);
   const customerId=input.customerId===undefined?Number(old.customer_id):id(input.customerId);
   const machineId=input.machineId===undefined?Number(old.machine_id):id(input.machineId);
   const customer=await port.first('SELECT * FROM customers WHERE id=?',[customerId]);
   const machine=await port.first('SELECT * FROM machines WHERE id=?',[machineId]);
   if(!customer)fail('Cliente não encontrado',404);
   if(!machine)fail('Máquina não encontrada',404);
   if(Number(machine.customer_id)!==customerId)fail('Máquina não pertence ao cliente',409);
   const technicianId=input.technicianId===undefined?old.technician_id:
     input.technicianId==null?null:id(input.technicianId);
   if(technicianId&&!await port.first('SELECT id FROM technicians WHERE id=?',[technicianId]))
     fail('Técnico não encontrado',404);
   const priority=input.priority??old.priority;
   if(!PRIORITIES.has(priority))fail('Prioridade inválida');
   const next={
     customer_id:customerId,machine_id:machineId,
     entered_at:input.enteredAt===undefined?old.entered_at:input.enteredAt,
     problem_reported:input.problemReported===undefined?old.problem_reported:clean(input.problemReported),
     diagnosis:input.diagnosis===undefined?old.diagnosis:clean(input.diagnosis),
     technician_id:technicianId,
     estimated_delivery:input.estimatedDelivery===undefined?old.estimated_delivery:input.estimatedDelivery||null,
     priority,internal_notes:input.internalNotes===undefined?old.internal_notes:clean(input.internalNotes)
   };
   if(!next.problem_reported)fail('Problema relatado é obrigatório');
   const customerSnapshot=customerId===Number(old.customer_id)?old.snapshot_customer:
     JSON.stringify({id:customer.id,name:customer.name,document:customer.document,
       phone:customer.phone,address:customer.address});
   const machineSnapshot=machineId===Number(old.machine_id)?old.snapshot_machine:
     JSON.stringify({id:machine.id,type:machine.type,brand:machine.brand,model:machine.model,
       year:machine.year,licensePlate:machine.license_plate||null,vin:machine.vin||null});
   const at=now(),values=Object.values(next);
   const update=command(`UPDATE work_orders SET
     customer_id=?,machine_id=?,entered_at=?,problem_reported=?,diagnosis=?,technician_id=?,
     estimated_delivery=?,priority=?,internal_notes=?,snapshot_customer=?,snapshot_machine=?,
     updated_at=?,version=version+1 WHERE id=? AND version=?`,[
     ...values,customerSnapshot,machineSnapshot,at,old.id,old.version
   ]);
   const changes=Object.entries(next).filter(([key,value])=>
     stringify(old[key])!==stringify(value));
   const histories=changes.map(([field,value])=>command(`INSERT INTO work_order_change_history(
     id,work_order_id,field,old_value,new_value,changed_at
   ) SELECT ?,?,?,?,?,? WHERE EXISTS(
     SELECT 1 FROM work_orders WHERE id=? AND version=? AND updated_at=?
   )`,[
     nextId(),old.id,field,stringify(old[field]),stringify(value),at,
     old.id,Number(old.version)+1,at
   ]));
   if(port.engine==='d1'){
     const result=await port.batch([update,...histories]);
     if(count(result[0])!==1)fail('Conflito de versão da OS',409);
   }else await port.transaction(async tx=>{
     const result=await tx.run(update.sql,update.params);
     if(count(result)!==1)fail('Conflito de versão da OS',409);
     for(const change of histories)await tx.run(change.sql,change.params);
   });
   return fullOrder(old.id);
 }
 async function getWorkOrderHistory(osId){
   await fullOrder(osId);
   return port.all(`SELECT 'STATUS' type,h.id source_id,NULL field,
     h.from_status old_value,h.to_status new_value,h.reason,h.changed_by,
     u.name changed_by_name,h.changed_at
     FROM work_order_status_history h LEFT JOIN users u ON u.id=h.changed_by
     WHERE h.work_order_id=?
     UNION ALL SELECT 'FIELD_CHANGE' type,c.id source_id,c.field,
     c.old_value,c.new_value,'' reason,c.changed_by,u.name changed_by_name,c.changed_at
     FROM work_order_change_history c LEFT JOIN users u ON u.id=c.changed_by
     WHERE c.work_order_id=?
     ORDER BY changed_at,type,source_id`,[id(osId),id(osId)]);
 }
 async function machineHistory(machineId){
   return port.all(`SELECT wo.id,wo.os_number,wo.status,wo.entered_at,
     wo.completed_at,wo.delivered_at,wo.problem_reported,wo.diagnosis,
     wo.quote_total_cents,t.name technician_name FROM work_orders wo
     LEFT JOIN technicians t ON t.id=wo.technician_id
     WHERE wo.machine_id=? ORDER BY wo.id DESC`,[id(machineId)]);
 }
 async function duplicateWorkOrder(workOrderId,input={}){
   const source=await fullOrder(workOrderId);
   const duplicate=await createWorkOrder({
     customerId:input.customerId??source.customer_id,
     machineId:input.machineId??source.machine_id,
     problemReported:input.copyProblem===false?clean(input.problemReported)||'Serviço a definir':source.problem_reported,
     diagnosis:input.copyDiagnosis?source.diagnosis:'',
     technicianId:input.copyTechnician===false?null:source.technician_id,
     priority:input.copyPriority===false?'NORMAL':source.priority,
     internalNotes:input.copyInternalNotes?source.internal_notes:'',
     unitId:input.unitId??source.unit_id
   });
   return fullOrder(duplicate.id);
 }
 async function getQuote(workOrderId){
   const q=await port.first('SELECT * FROM quotes WHERE work_order_id=?',[id(workOrderId)]);
   if(!q)fail('Orçamento não encontrado',404);
   return {...q,items:await port.all('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id',[q.id])};
 }
 async function submitQuote({workOrderId}={}){
   const order=await fullOrder(workOrderId),q=await getQuote(workOrderId);
   if(order.status!=='ORCAMENTO'||q.approval_status!=='RASCUNHO')
     fail('OS não está em orçamento',409);
   const at=now(),orderUpdate=command(`UPDATE work_orders SET
     status='AGUARDANDO_APROVACAO',updated_at=?,version=version+1
     WHERE id=? AND version=? AND status='ORCAMENTO'`,[at,order.id,order.version]);
   const quoteUpdate=command(`UPDATE quotes SET approval_status='AGUARDANDO',updated_at=?
     WHERE id=? AND approval_status='RASCUNHO'`,[at,q.id]);
   const history=command(`INSERT INTO work_order_status_history(
     id,work_order_id,from_status,to_status,reason,changed_at)
     SELECT ?,?,'ORCAMENTO','AGUARDANDO_APROVACAO','Orçamento enviado',?
     WHERE EXISTS(SELECT 1 FROM quotes WHERE id=? AND approval_status='AGUARDANDO')`,[
     nextId(),order.id,at,q.id
   ]);
   if(port.engine==='d1'){
     const rows=await port.batch([orderUpdate,quoteUpdate,history]);
     if(count(rows[0])!==1||count(rows[1])!==1)fail('Conflito ao enviar orçamento',409);
   }else await port.transaction(async tx=>{
     if(count(await tx.run(orderUpdate.sql,orderUpdate.params))!==1)fail('Conflito de versão',409);
     if(count(await tx.run(quoteUpdate.sql,quoteUpdate.params))!==1)fail('Conflito de orçamento',409);
     await tx.run(history.sql,history.params);
   });
   return getQuote(order.id);
 }
 async function rejectQuote({workOrderId,reason}={}){
   const order=await fullOrder(workOrderId),quote=await getQuote(workOrderId);
   const why=clean(reason);
   if(!why)fail('Motivo da reprovação é obrigatório');
   if(!['ORCAMENTO','AGUARDANDO_APROVACAO'].includes(order.status))
     fail('OS não aguarda aprovação',409);
   const at=now(),update=command(`UPDATE work_orders SET
     status='REPROVADA',version=version+1,updated_at=?
     WHERE id=? AND version=? AND status IN ('ORCAMENTO','AGUARDANDO_APROVACAO')`,[
     at,order.id,order.version
   ]);
   const quoteUpdate=command(`UPDATE quotes SET
     approval_status='REPROVADO',rejection_reason=?,rejected_at=?,updated_at=?
     WHERE id=? AND approval_status IN ('RASCUNHO','AGUARDANDO')`,[
     why,at,at,quote.id
   ]);
   const history=command(`INSERT INTO work_order_status_history(
     id,work_order_id,from_status,to_status,reason,changed_at
   ) VALUES(?,?,?,?,?,?)`,[
     nextId(),order.id,order.status,'REPROVADA',why,at
   ]);
   if(port.engine==='d1'){
     const rows=await port.batch([update,quoteUpdate,history]);
     if(count(rows[0])!==1||count(rows[1])!==1)fail('Conflito na reprovação',409);
   }else await port.transaction(async tx=>{
     if(count(await tx.run(update.sql,update.params))!==1)fail('Conflito de versão',409);
     if(count(await tx.run(quoteUpdate.sql,quoteUpdate.params))!==1)fail('Conflito de orçamento',409);
     await tx.run(history.sql,history.params);
   });
   return getQuote(order.id);
 }
 return Object.freeze({
   fullOrder,listWorkOrders,listWorkOrdersPage,updateWorkOrder,getWorkOrderHistory,
   machineHistory,duplicateWorkOrder,getQuote,submitQuote,rejectQuote
 });
}
