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
export function unpublishedOutbox(db,limit=100){
 return db.prepare('SELECT * FROM domain_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT ?').all(limit);
}
async function dispatch(db,runtime,limit){
 let delivered=0;
 const rows=unpublishedOutbox(db,limit);
 for(const row of rows){
   const event=createDomainEvent(row.event_type,JSON.parse(row.payload_json),{
     ...JSON.parse(row.meta_json),eventId:row.event_id,occurredAt:row.created_at
   });
   try{
     if(typeof runtime.deliver!=='function')throw new Error('Runtime sem entrega confirmada');
     await runtime.deliver(event);
     db.prepare('UPDATE domain_outbox SET delivered_at=?,last_error=? WHERE id=? AND delivered_at IS NULL')
       .run(nowIso(),'',row.id);
     delivered++;
   }catch(error){
     db.prepare('UPDATE domain_outbox SET attempts=attempts+1,last_error=? WHERE id=?')
       .run(String(error?.message||error).slice(0,500),row.id);
     // Reconhecer outros eventos mesmo se uma integração específica falhar.
   }
 }
 return delivered;
}
export function dispatchOutbox(db,runtime,limit=100){
 if(!runtime)return Promise.resolve(0);
 if(inFlight.has(db)){
   reschedule.add(db);
   return inFlight.get(db);
 }
 const job=(async()=>{
   let count=0;
   while(true){
     const n=await dispatch(db,runtime,limit);
     count+=n;
     if(n<limit)break;
   }
   return count;
 })().finally(()=>{
   inFlight.delete(db);
   if(reschedule.has(db)){
     reschedule.delete(db);
     queueMicrotask(()=>void dispatchOutbox(db,runtime,limit).catch(()=>{}));
   }
 });
 inFlight.set(db,job);
 return job;
}
