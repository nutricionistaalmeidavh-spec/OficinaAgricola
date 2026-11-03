import {randomUUID} from 'node:crypto';
import {nowIso} from '../db.js';
import {createDomainEvent} from './events.js';
import {describeHttpMutation} from './http-event-bridge.js';

const inFlight=new WeakMap();
const reschedule=new WeakSet();
function identity(method,path,data,descriptor,db){
 const {type,payload}=descriptor;
 const ref=payload.movementId??payload.receiptId??payload.saleId??
   payload.cashMovementId??payload.workOrderPartId??payload.cashSessionId??payload.workOrderId;
 if(type==='WORK_ORDER_STATUS_CHANGED'){
   const id=payload.workOrderId;
   return type+':'+(db.prepare('SELECT id FROM work_order_status_history WHERE work_order_id=? ORDER BY id DESC LIMIT 1').get(id)?.id??'none');
 }
 if(type==='QUOTE_APPROVED')return type+':'+(payload.quoteId??data?.id);
 return type+':'+String(ref??JSON.stringify(payload));
}
export function enqueueHttpEvent(db,method,path,data,{requestId=null,actorId=null}={}){
 // Autenticação tem auditoria própria; não gravar resposta de login ou token.
 if(['/api/auth/login','/api/auth/logout'].includes(path))return null;
 const known=describeHttpMutation(method,path,data);
 // O evento genérico não inclui o payload original: pode conter senhas,
 // tokens e outros dados privados. Registra somente o recurso alterado.
 const descriptor=known||{
   type:'ENTITY_MUTATED',
   payload:{method:String(method||''),path:String(path||''),resourceId:data?.id??null},
   meta:{correlationId:String(path||'')}
 };
 const eventKey=known?identity(method,path,data,descriptor,db):
   requestId?`ENTITY_MUTATED:${method}:${path}:${actorId??'system'}:${requestId}`:
   `ENTITY_MUTATED:${randomUUID()}`;
 const eventId=randomUUID();
 db.prepare(`INSERT OR IGNORE INTO domain_outbox(
   event_key,event_id,event_type,payload_json,meta_json,created_at
 ) VALUES(?,?,?,?,?,?)`).run(eventKey,eventId,descriptor.type,
   JSON.stringify(descriptor.payload),JSON.stringify({...descriptor.meta,actorId:actorId??null}),nowIso());
 return db.prepare('SELECT * FROM domain_outbox WHERE event_key=?').get(eventKey);
}
export function unpublishedOutbox(db,limit=100,{now=new Date().toISOString(),dueOnly=false,afterId=0}={}){
 const size=Math.max(1,Math.min(500,Number(limit)||100));
 return db.prepare('SELECT * FROM domain_outbox WHERE delivered_at IS NULL AND id>? AND (?=0 OR next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY id LIMIT ?')
   .all(afterId,dueOnly?1:0,now,size);
}
async function dispatch(db,runtime,limit,{respectBackoff=false,afterId=0}={}){
 let delivered=0;
 const rows=unpublishedOutbox(db,limit,{dueOnly:respectBackoff,afterId});
 for(const row of rows){
   const event=createDomainEvent(row.event_type,JSON.parse(row.payload_json),{
     ...JSON.parse(row.meta_json),eventId:row.event_id,occurredAt:row.created_at
   });
   try{
     if(typeof runtime.deliver!=='function')throw new Error('Runtime sem entrega confirmada');
     await runtime.deliver(event);
     db.prepare('UPDATE domain_outbox SET delivered_at=?,next_attempt_at=NULL,last_error=? WHERE id=? AND delivered_at IS NULL')
       .run(nowIso(),'',row.id);
     delivered++;
   }catch(error){
     const retries=row.attempts+1;
     const delayMs=Math.min(3600000,5000*Math.pow(2,Math.min(retries-1,10)));
     const nextAttempt=new Date(Date.now()+delayMs).toISOString();
     db.prepare('UPDATE domain_outbox SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE id=?')
       .run(String(error?.message||error).slice(0,500),nextAttempt,row.id);
     // Reconhecer outros eventos mesmo se uma integração específica falhar.
   }
 }
 return {delivered,attempted:rows.length,lastId:rows.at(-1)?.id??afterId};
}
export function dispatchOutbox(db,runtime,limit=100,{respectBackoff=false}={}){
 if(!runtime)return Promise.resolve(0);
 if(inFlight.has(db)){
   reschedule.add(db);
   return inFlight.get(db);
 }
 const job=(async()=>{
   let count=0,afterId=0;
   while(true){
     const {delivered,attempted,lastId}=await dispatch(db,runtime,limit,{respectBackoff,afterId});
     afterId=lastId;
     count+=delivered;
     if(attempted<Math.max(1,Math.min(500,Number(limit)||100)))break;
   }
   return count;
 })().finally(()=>{
   inFlight.delete(db);
   if(reschedule.has(db)){
     reschedule.delete(db);
     queueMicrotask(()=>void dispatchOutbox(db,runtime,limit,{respectBackoff:true}).catch(()=>{}));
   }
 });
 inFlight.set(db,job);
 return job;
}
