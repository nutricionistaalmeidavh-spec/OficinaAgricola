import {runIdempotent} from '../platform/idempotency.js';
import {createWorkOrder,getWorkOrder,transitionWorkOrderInTransaction} from './work-orders.js';
import {getQuote,saveQuote} from './quotes.js';

// Um comando único: duplicação e cópia opcional do orçamento são atômicas.
// Nenhum consumo de estoque, pagamento ou movimento de caixa é copiado.
export function duplicateWorkOrderWithQuote(db,originalId,input={}, {createdBy=null}={}){
 const {requestId,...command}=input;
 return runIdempotent(db,`work-order:${originalId}:duplicate`,requestId,
   {originalId,...command,createdBy},()=>{
     const source=getWorkOrder(db,originalId);
     const created=createWorkOrder(db,{
       customerId:command.customerId??source.customer_id,
       machineId:command.machineId??source.machine_id,
       problemReported:String(command.problemReported??source.problem_reported).trim(),
       diagnosis:String(command.diagnosis??'').trim(),
       technicianId:command.technicianId??source.technician_id,
       priority:command.priority??source.priority,
       internalNotes:String(command.internalNotes??'').trim(),
       createdBy
     });
     if(command.copyQuote===true){
       const quote=getQuote(db,originalId);
       transitionWorkOrderInTransaction(db,created.id,'DIAGNOSTICO',{
         reason:'Preparação de orçamento reutilizado',changedBy:createdBy
       });
       saveQuote(db,created.id,{
         discountCents:quote.discount_cents,
         validUntil:null,notes:quote.notes,
         items:quote.items.map(i=>({
           kind:i.kind,description:i.description,
           quantity:i.quantity,unitPriceCents:i.unit_price_cents
         }))
       });
     }
     return getWorkOrder(db,created.id);
   });
}
