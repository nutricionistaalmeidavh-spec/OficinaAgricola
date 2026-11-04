import {randomBytes,createHash} from 'node:crypto';
import {assertTransition,calculateQuote} from '../domain.js';
import {createAsyncWorkshopCatalog} from './async-workshop-catalog.js';
import {createAsyncWorkshopSales} from './async-workshop-sales.js';
import {createAsyncWorkshopOperations} from './async-workshop-operations.js';
import {createAsyncWorkshopFiscal} from './async-workshop-fiscal.js';
import {createAsyncWorkshopFinance} from './async-workshop-finance.js';
import {createAsyncWorkshopOrders} from './async-workshop-orders.js';
import {createAsyncWorkshopInventory} from './async-workshop-inventory.js';
import {createAsyncWorkshopAutomotive} from './async-workshop-automotive.js';
import {createAsyncWorkshopAuth} from './async-workshop-auth.js';
import {createAsyncWorkshopCrm} from './async-workshop-crm.js';
import {createAsyncWorkshopAttachments} from './async-workshop-attachments.js';

// Async canonical service layer for PostgreSQL and D1. Each command is
// explicitly transactional on its backend; never delegate to legacy SQLite.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const numericId=value=>{
 const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;
};
const id=()=>randomBytes(6).readUIntBE(0,6);
const iso=()=>new Date().toISOString();
const text=value=>String(value??'').trim();
const cents=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)fail('Valor monetário inválido');return n;};
const changes=value=>Number(value?.changes??value?.meta?.changes??0);
const serial=value=>Number.isFinite(Number(value))?Number(value):value;
async function atomic(port,queries){
 if(port.engine==='d1')return port.batch(queries);
 return port.transaction(async tx=>{
   const out=[];for(const q of queries)out.push(await tx.run(q.sql,q.params));
   return out;
 });
}
const select=(sql,params=[])=>({sql,params});
export function createAsyncWorkshopServices(port,{fiscalProvider=null,objectStore=null}={}){
 if(!['sqlite','d1','postgres'].includes(port?.engine))fail('Serviço exige adaptador SQL comum válido');
 async function createCustomer(input={}){
   const name=text(input.name);if(!name)fail('Nome do cliente obrigatório');
   const customerId=id(),at=iso();
   await port.run(`INSERT INTO customers(id,name,document,phone,email,address,notes,active,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,1,?,?)`,[
     customerId,name,text(input.document),text(input.phone),
     text(input.email),text(input.address),text(input.notes),at,at
   ]);
   return port.first('SELECT * FROM customers WHERE id=?',[customerId]);
 }
 async function createMachine(input={}){
   const customerId=numericId(input.customerId);
   if(!await port.first('SELECT id FROM customers WHERE id=? AND active=1',[customerId]))
     fail('Cliente não encontrado',404);
   const type=text(input.type);if(!type)fail('Tipo de máquina obrigatório');
   const machineId=id(),at=iso();
   await port.run(`INSERT INTO machines(
     id,customer_id,type,brand,model,year,serial_number,internal_id,
     hour_meter,license_plate,vin,odometer_km,renavam,engine,fuel_type,notes,
     active,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,[
     machineId,customerId,type,text(input.brand),text(input.model),
     input.year==null?null:Number(input.year),text(input.serialNumber),
     text(input.internalId),Number(input.hourMeter??0),text(input.plate)||null,
     text(input.vin)||null,input.odometerKm==null?null:Number(input.odometerKm),
     text(input.renavam)||null,text(input.engine),text(input.fuelType)||null,
     text(input.notes),at,at
   ]);
   return port.first('SELECT * FROM machines WHERE id=?',[machineId]);
 }
 async function getWorkOrder(workOrderId){
   const row=await port.first('SELECT * FROM work_orders WHERE id=?',[numericId(workOrderId)]);
   if(!row)fail('Ordem de serviço não encontrada',404);
   return row;
 }
 async function createWorkOrder(input={}){
   const customerId=numericId(input.customerId),machineId=numericId(input.machineId);
   const problem=text(input.problemReported);if(!problem)fail('Problema relatado é obrigatório');
   const customer=await port.first('SELECT * FROM customers WHERE id=? AND active=1',[customerId]);
   if(!customer)fail('Cliente não encontrado',404);
   const machine=await port.first('SELECT * FROM machines WHERE id=? AND customer_id=? AND active=1',[machineId,customerId]);
   if(!machine)fail('Máquina não pertence ao cliente',409);
   const workOrderId=id(),at=iso(),priority=text(input.priority)||'NORMAL';
   if(!new Set(['BAIXA','NORMAL','ALTA','URGENTE']).has(priority))fail('Prioridade inválida');
   const fields=[
     workOrderId,customerId,machineId,text(input.enteredAt)||at,problem,
     text(input.diagnosis),null,input.estimatedDelivery??null,priority,
     text(input.internalNotes),JSON.stringify({id:customer.id,name:customer.name,
       document:customer.document,phone:customer.phone,address:customer.address}),
     JSON.stringify({id:machine.id,type:machine.type,brand:machine.brand,
       model:machine.model,vin:machine.vin}),at,at
   ];
   const statements=[
    select(`INSERT INTO work_orders(
       id,os_number,customer_id,machine_id,entered_at,problem_reported,
       diagnosis,technician_id,estimated_delivery,priority,internal_notes,
       status,snapshot_customer,snapshot_machine,created_at,updated_at
     ) VALUES(?,${port.engine==='postgres'?"nextval('async_os_number_seq')":'(SELECT COALESCE(MAX(os_number),0)+1 FROM work_orders)'},?,?,?,?,?,?,?,?,?,'ENTRADA',?,?,?,?)`,fields),
    select(`INSERT INTO work_order_status_history(
       work_order_id,from_status,to_status,reason,changed_at
     ) VALUES(?,NULL,'ENTRADA','Abertura da OS',?)`,[workOrderId,at]),
    select(`INSERT INTO domain_outbox(
       event_key,event_id,event_type,payload_json,meta_json,created_at
     ) VALUES(?,?,'OS_CRIADA',?,?,?)`,[
       'OS_CRIADA:'+workOrderId,randomBytes(16).toString('hex'),
       JSON.stringify({workOrderId}),JSON.stringify({source:'async-workshop'}),at
     ])
   ];
   await atomic(port,statements);
   return getWorkOrder(workOrderId);
 }
 async function createPart(input={}){
   const sku=text(input.sku),description=text(input.description);
   if(!sku||!description)fail('SKU e descrição são obrigatórios');
   const partId=id(),at=iso();
   await port.run(`INSERT INTO parts(
     id,sku,description,category,unit,cost_cents,sale_price_cents,
     quantity,min_stock,location,active,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,0,?,?,1,?,?)`,[
     partId,sku,description,text(input.category),text(input.unit)||'UN',
     cents(input.costCents??0),cents(input.salePriceCents??0),
     Number(input.minStock??0),text(input.location),at,at
   ]);
   return port.first('SELECT * FROM parts WHERE id=?',[partId]);
 }
 async function postStockMovement({partId,type,quantity,note='',workOrderId=null}={}){
   const p=numericId(partId),q=Number(quantity);
   if(!Number.isFinite(q)||q<=0||q>1000000)fail('Quantidade inválida');
   const allowed={ENTRADA:1,ESTORNO:1,SAIDA_MANUAL:-1,CONSUMO_OS:-1};
   if(!Object.hasOwn(allowed,type))fail('Tipo de movimentação inválido');
   const delta=q*allowed[type],at=iso(),movementId=id();
   const update=select(`UPDATE parts SET quantity=quantity+?,updated_at=?
     WHERE id=? AND active=1 AND quantity+?>=-0.00000001`,[delta,at,p,delta]);
   if(port.engine!=='postgres'){
     const result=await atomic(port,[
       update,
       select(`INSERT INTO inventory_movements(
         id,part_id,type,quantity_delta,work_order_id,note,created_at
       ) SELECT ?,?,?,?,?,?,? WHERE changes()=1`,[
         movementId,p,type,delta,workOrderId,text(note),at
       ])
     ]);
     if(changes(result[0])!==1)fail('Estoque insuficiente',409);
   }else await port.transaction(async tx=>{
     const updated=await tx.run(update.sql,update.params);
     if(changes(updated)!==1)fail('Estoque insuficiente',409);
     await tx.run(`INSERT INTO inventory_movements(
       id,part_id,type,quantity_delta,work_order_id,note,created_at
     ) VALUES(?,?,?,?,?,?,?)`,[movementId,p,type,delta,workOrderId,text(note),at]);
   });
   return {id:movementId,partId:p,type,quantityDelta:delta};
 }
 async function receivePayment(input={}){
   const workOrderId=numericId(input.workOrderId),amount=cents(input.amountCents);
   if(!amount)fail('Valor do recebimento inválido');
   const method=text(input.method),requestId=text(input.requestId);
   if(!method)fail('Forma de pagamento obrigatória');
   if(!requestId||requestId.length>128)fail('Identificador idempotente obrigatório');
   const fingerprint=createHash('sha256').update(JSON.stringify({workOrderId,amount,method})).digest('hex');
   const previous=await port.first('SELECT * FROM receipts WHERE request_id=?',[requestId]);
   if(previous){
     if(previous.request_payload_hash!==fingerprint)
       fail('Identificador de pagamento já utilizado para outra operação',409);
     return previous;
   }
   const cash=await port.first("SELECT id FROM cash_sessions WHERE status='ABERTO' ORDER BY id DESC LIMIT 1");
   if(method.toUpperCase()==='DINHEIRO'&&!cash)
     fail('Abra o caixa para receber em dinheiro',409);
   const receiptId=id(),eventId=id(),at=iso();
   const insert=select(`INSERT INTO receipts(
     id,work_order_id,amount_cents,method,received_at,request_id,request_payload_hash
   ) SELECT ?,?,?,?,?,?,? WHERE EXISTS(
     SELECT 1 FROM work_orders wo
     JOIN quotes q ON q.work_order_id=wo.id
     WHERE wo.id=? AND q.approval_status='APROVADO'
       AND wo.status<>'CANCELADA'
       AND wo.quote_total_cents-
         COALESCE((SELECT SUM(r.amount_cents) FROM receipts r
           WHERE r.work_order_id=wo.id AND r.reversed_at IS NULL),0)>=?
   ) ON CONFLICT DO NOTHING`,[
     receiptId,workOrderId,amount,method,at,requestId,fingerprint,workOrderId,amount
   ]);
   const event=select(`INSERT INTO payment_events(
     id,source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at
   ) SELECT ?,'OS_RECEIPT',?,'PAID',?,?,?,? FROM receipts WHERE id=?`,[
     eventId,receiptId,amount,method,cash?.id??null,at,receiptId
   ]);
   const cashMovement=cash?select(`INSERT INTO cash_movements(
     id,cash_session_id,receipt_id,type,amount_cents,payment_method,note,created_at
   ) SELECT ?,CASE WHEN
       (SELECT status FROM cash_sessions WHERE id=?)='ABERTO'
       THEN ? ELSE -1 END,?,'VENDA',?,?,?,?
     FROM receipts WHERE id=?`,[
       id(),cash.id,cash.id,receiptId,amount,method,
       'Recebimento OS '+workOrderId,at,receiptId
     ]):null;
   const writeCommands=[insert,event,...(cashMovement?[cashMovement]:[])];
   if(port.engine!=='postgres'){
     const output=await atomic(port,writeCommands);
     if(changes(output[0])!==1){
       // D1 batch is atomic but an identical replay may have won the race
       // after the original preflight read. Never duplicate the payment event.
       const stored=await port.first('SELECT * FROM receipts WHERE request_id=?',[requestId]);
       if(stored){
         if(stored.request_payload_hash!==fingerprint)
           fail('Identificador de pagamento já utilizado para outra operação',409);
         return stored;
       }
       fail('Saldo insuficiente ou orçamento não aprovado',409);
     }
     return port.first('SELECT * FROM receipts WHERE id=?',[receiptId]);
   }
   return port.transaction(async tx=>{
     // Lock the OS row BEFORE the second idempotency check. Concurrent
     // payments for the same OS cannot both pass an old balance snapshot.
     const os=await tx.first('SELECT id FROM work_orders WHERE id=? FOR UPDATE',[workOrderId]);
     if(!os)fail('OS não encontrada',404);
     const stored=await tx.first('SELECT * FROM receipts WHERE request_id=?',[requestId]);
     if(stored){
       if(stored.request_payload_hash!==fingerprint)
         fail('Identificador de pagamento já utilizado para outra operação',409);
       return stored;
     }
     if(cash){
       const opened=await tx.first(
         "SELECT id FROM cash_sessions WHERE id=? AND status='ABERTO' FOR UPDATE",[cash.id]);
       if(!opened)fail('Caixa foi fechado durante o recebimento',409);
     }
     const output=await tx.run(insert.sql,insert.params);
     if(changes(output)!==1)fail('Saldo insuficiente ou orçamento não aprovado',409);
     await tx.run(event.sql,event.params);
     if(cashMovement)await tx.run(cashMovement.sql,cashMovement.params);
     return tx.first('SELECT * FROM receipts WHERE id=?',[receiptId]);
   });
 }
 async function financeSummary({from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z'}={}){
   const invoiced=await port.first(`SELECT COALESCE(SUM(q.total_cents),0) total
     FROM quotes q JOIN work_orders wo ON wo.id=q.work_order_id
     WHERE q.approval_status='APROVADO' AND wo.status<>'CANCELADA'
       AND q.approved_at BETWEEN ? AND ?`,[from,to]);
   const pending=await port.first(`SELECT COALESCE(SUM(CASE
     WHEN wo.quote_total_cents-COALESCE(r.paid,0)>0
     THEN wo.quote_total_cents-COALESCE(r.paid,0) ELSE 0 END),0) total
     FROM quotes q JOIN work_orders wo ON wo.id=q.work_order_id
     LEFT JOIN (SELECT work_order_id,SUM(amount_cents) paid
       FROM receipts WHERE reversed_at IS NULL GROUP BY work_order_id) r
       ON r.work_order_id=wo.id
     WHERE q.approval_status='APROVADO' AND wo.status<>'CANCELADA'
       AND q.approved_at BETWEEN ? AND ?`,[from,to]);
   const pos=await port.first(`SELECT COALESCE(SUM(total_cents),0) total
     FROM sales WHERE status='CONCLUIDA' AND created_at BETWEEN ? AND ?`,[from,to]);
   const payments=await port.first(`SELECT COALESCE(SUM(amount_cents),0) total
     FROM payment_events WHERE created_at BETWEEN ? AND ?`,[from,to]);
   const expense=await port.first(`SELECT COALESCE(SUM(amount_cents),0) total
     FROM expenses WHERE paid_at IS NOT NULL AND paid_at BETWEEN ? AND ?`,[from,to]);
   const receivedCents=serial(payments.total),expensesCents=serial(expense.total);
   return {
     invoicedCents:serial(invoiced.total)+serial(pos.total),
     receivedCents,pendingCents:serial(pending.total),expensesCents,
     resultCents:receivedCents-expensesCents
   };
 }
 async function transitionWorkOrder({workOrderId,toStatus,expectedVersion,reason=''}={}){
   const current=await getWorkOrder(workOrderId);
   if(!Number.isSafeInteger(Number(expectedVersion))||Number(expectedVersion)!==Number(current.version))
     fail('Conflito de versão: recarregue a OS',409);
   assertTransition(current.status,toStatus);
   if(toStatus==='CANCELADA'){
     const activeParts=await port.first(`SELECT COUNT(*) n FROM work_order_parts
       WHERE work_order_id=? AND reversed_at IS NULL`,[current.id]);
     if(Number(activeParts.n)>0)fail('A OS não pode ser cancelada enquanto houver peças consumidas sem estorno',409);
     const activeReceipts=await port.first(`SELECT COUNT(*) n FROM receipts
       WHERE work_order_id=? AND reversed_at IS NULL`,[current.id]);
     if(Number(activeReceipts.n)>0)fail('A OS não pode ser cancelada enquanto houver recebimentos sem estorno',409);
   }
   const at=iso();
   let completed=current.completed_at,delivered=current.delivered_at;
   if(toStatus==='PRONTA')completed=at;
   if(toStatus==='ENTREGUE')delivered=at;
   if(toStatus==='EM_SERVICO'&&current.status==='PRONTA')completed=null;
   const updated=select(`UPDATE work_orders SET status=?,completed_at=?,delivered_at=?,
      version=version+1,updated_at=? WHERE id=? AND version=? AND status=?`,[
     toStatus,completed,delivered,at,current.id,current.version,current.status
   ]);
   const history=select(`INSERT INTO work_order_status_history(
      work_order_id,from_status,to_status,reason,changed_at
     ) SELECT ?,?,?,?,? WHERE changes()=1`,[
     current.id,current.status,toStatus,text(reason),at
   ]);
   if(port.engine!=='postgres'){
     const results=await atomic(port,[updated,history]);
     if(changes(results[0])!==1)fail('Conflito de versão durante mudança de estado',409);
   }else await port.transaction(async tx=>{
     const result=await tx.run(updated.sql,updated.params);
     if(changes(result)!==1)fail('Conflito de versão durante mudança de estado',409);
     await tx.run(`INSERT INTO work_order_status_history(
       work_order_id,from_status,to_status,reason,changed_at
     ) VALUES(?,?,?,?,?)`,[current.id,current.status,toStatus,text(reason),at]);
   });
   return getWorkOrder(current.id);
 }
 async function saveQuote({workOrderId,items=[],discountCents=0,notes=''}={}){
   const order=await getWorkOrder(workOrderId);
   if(!['DIAGNOSTICO','ORCAMENTO','REPROVADA'].includes(order.status))
     fail('OS não permite orçamento neste estágio',409);
   const old=await port.first('SELECT * FROM quotes WHERE work_order_id=?',[order.id]);
   if(old?.approval_status==='APROVADO')fail('Orçamento aprovado não pode ser alterado',409);
   if(!Array.isArray(items)||!items.length||items.length>100)fail('Itens de orçamento inválidos');
   const list=items.map(item=>{
     const kind=text(item.kind),description=text(item.description),quantity=Number(item.quantity);
     const unitPriceCents=cents(item.unitPriceCents);
     if(!new Set(['PECA','MAO_DE_OBRA','TERCEIRO']).has(kind)||!description||
       !Number.isFinite(quantity)||quantity<=0||quantity>100000)
       fail('Item de orçamento inválido');
     return {kind,description,quantity,unitPriceCents,
       totalCents:Math.round(quantity*unitPriceCents)};
   });
   const totals=calculateQuote(list,cents(discountCents)),at=iso();
   const quoteId=old?numericId(old.id):id();
   const update=select(`UPDATE work_orders SET status='ORCAMENTO',
     version=version+1,updated_at=?
     WHERE id=? AND version=? AND status IN ('DIAGNOSTICO','ORCAMENTO','REPROVADA')`,[
     at,order.id,order.version
   ]);
   const upsert=old
     ?select(`UPDATE quotes SET
       subtotal_cents=?,discount_cents=?,total_cents=?,
       notes=?,approval_status='RASCUNHO',updated_at=?
       WHERE id=? AND approval_status<>'APROVADO'`,[
       totals.subtotalCents,totals.discountCents,totals.totalCents,
       text(notes),at,quoteId
     ])
     :select(`INSERT INTO quotes(
       id,work_order_id,subtotal_cents,discount_cents,total_cents,
       notes,approval_status,created_at,updated_at
     ) VALUES(?,?,?,?,?,?,'RASCUNHO',?,?)`,[
       quoteId,order.id,totals.subtotalCents,totals.discountCents,
       totals.totalCents,text(notes),at,at
     ]);
   const clear=select('DELETE FROM quote_items WHERE quote_id=?',[quoteId]);
   const addLines=list.map(item=>select(`INSERT INTO quote_items(
     id,quote_id,kind,description,quantity,unit_price_cents,total_cents
   ) VALUES(?,?,?,?,?,?,?)`,[
     id(),quoteId,item.kind,item.description,item.quantity,item.unitPriceCents,item.totalCents
   ]));
   if(port.engine!=='postgres'){
     const result=await atomic(port,[update,upsert,clear,...addLines]);
     if(changes(result[0])!==1||changes(result[1])!==1)
       fail('Conflito de versão ou orçamento aprovado',409);
   }else await port.transaction(async tx=>{
     const updated=await tx.run(update.sql,update.params);
     if(changes(updated)!==1)fail('Conflito de versão',409);
     const saved=await tx.run(upsert.sql,upsert.params);
     if(changes(saved)!==1)fail('Orçamento aprovado',409);
     await tx.run(clear.sql,clear.params);
     for(const command of addLines)await tx.run(command.sql,command.params);
   });
   return port.first('SELECT * FROM quotes WHERE work_order_id=?',[order.id]);
 }
 async function approveQuote({workOrderId}={}){
   const os=await getWorkOrder(workOrderId);
   if(!['ORCAMENTO','AGUARDANDO_APROVACAO'].includes(os.status))
     fail('OS não está em orçamento',409);
   const quote=await port.first('SELECT * FROM quotes WHERE work_order_id=?',[os.id]);
   if(!quote||!['RASCUNHO','AGUARDANDO'].includes(quote.approval_status))
     fail('Orçamento não pode ser aprovado',409);
   const at=iso();
   const orderUpdate=select(`UPDATE work_orders SET status='APROVADA',
     quote_total_cents=?,version=version+1,updated_at=?
     WHERE id=? AND version=? AND status IN ('ORCAMENTO','AGUARDANDO_APROVACAO')`,[
     quote.total_cents,at,os.id,os.version
   ]);
   const quoteUpdate=select(`UPDATE quotes SET approval_status='APROVADO',
     approved_at=?,updated_at=? WHERE id=? AND approval_status IN ('RASCUNHO','AGUARDANDO')`,[
     at,at,quote.id
   ]);
   if(port.engine!=='postgres'){
     const result=await atomic(port,[
       orderUpdate,quoteUpdate,
       select(`INSERT INTO work_order_status_history(work_order_id,from_status,to_status,reason,changed_at)
         SELECT ?,?,'APROVADA','Orçamento aprovado',? WHERE changes()=1`,[
         os.id,os.status,at
       ])
     ]);
     if(changes(result[0])!==1||changes(result[1])!==1)
       fail('Conflito na aprovação do orçamento',409);
   }else await port.transaction(async tx=>{
     const changed=await tx.run(orderUpdate.sql,orderUpdate.params);
     if(changes(changed)!==1)fail('Conflito de versão',409);
     const saved=await tx.run(quoteUpdate.sql,quoteUpdate.params);
     if(changes(saved)!==1)fail('Conflito de orçamento',409);
     await tx.run(`INSERT INTO work_order_status_history(work_order_id,from_status,to_status,reason,changed_at)
       VALUES(?,?,'APROVADA','Orçamento aprovado',?)`,[
       os.id,os.status,at
     ]);
   });
   return port.first('SELECT * FROM quotes WHERE id=?',[quote.id]);
 }
 function fiscalNetLines(items,discountCents){
   const gross=items.reduce((sum,item)=>sum+Number(item.total_cents),0);
   if(!Number.isSafeInteger(gross)||gross<=0||!Number.isSafeInteger(Number(discountCents))||
      Number(discountCents)<0||Number(discountCents)>gross)fail('Totais fiscais inválidos');
   const shares=items.map((item,index)=>{
     const raw=Number(item.total_cents)*discountCents/gross;
     return {index,discount:Math.floor(raw),fraction:raw-Math.floor(raw)};
   });
   let remaining=discountCents-shares.reduce((sum,x)=>sum+x.discount,0);
   const order=[...shares].sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
   for(let i=0;i<remaining;i++)order[i%order.length].discount++;
   return items.map((item,index)=>({
     sourceItemId:item.id,kind:item.kind,description:item.description,
     quantity:item.quantity,unitPriceCents:item.unit_price_cents,
     subtotalCents:item.total_cents,discountCents:shares[index].discount,
     totalCents:item.total_cents-shares[index].discount
   }));
 }
 async function createFiscalDraft({originType='OS',originId,kind,requestId}={}){
   const origin=text(originType).toUpperCase(),type=text(kind).toUpperCase();
   if(origin!=='OS'||!['NFE','NFSE'].includes(type))
     fail('O backend async inicial permite somente rascunho fiscal da OS',409);
   const orderId=numericId(originId),request=text(requestId);
   if(!request||request.length>128)fail('Identificador fiscal obrigatório');
   const byRequest=await port.first('SELECT * FROM fiscal_documents WHERE request_id=?',[request]);
   if(byRequest){
     if(byRequest.origin_type!==origin||Number(byRequest.origin_id)!==orderId||byRequest.kind!==type)
       fail('Identificador fiscal já usado em outra operação',409);
     return byRequest;
   }
   const existing=await port.first(`SELECT * FROM fiscal_documents
     WHERE origin_type=? AND origin_id=? AND kind=?`,[origin,orderId,type]);
   if(existing)return existing;
   const os=await getWorkOrder(orderId);
   const quote=await port.first(`SELECT * FROM quotes
     WHERE work_order_id=? AND approval_status='APROVADO'`,[orderId]);
   if(!quote||Number(os.quote_total_cents)!==Number(quote.total_cents))
     fail('Orçamento fiscal da OS não aprovado ou divergente',409);
   const items=await port.all('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id',[quote.id]);
   if(items.some(i=>i.kind==='TERCEIRO'))fail('Serviço de terceiro requer classificação tributária',409);
   const lines=fiscalNetLines(items,Number(quote.discount_cents))
     .filter(i=>type==='NFE'?i.kind==='PECA':i.kind==='MAO_DE_OBRA');
   if(!lines.length)fail('Nenhum item correspondente ao tipo fiscal');
   const amount=lines.reduce((sum,l)=>sum+Number(l.totalCents),0);
   if(!Number.isSafeInteger(amount)||amount<=0)fail('Valor fiscal inválido');
   const snapshot=JSON.stringify({
     originType:origin,originId:orderId,originNumber:os.os_number,
     approvedAt:quote.approved_at,
     kind:type,lines,customer:JSON.parse(os.snapshot_customer),
     machine:JSON.parse(os.snapshot_machine)
   });
   const hash=createHash('sha256').update(snapshot).digest('hex');
   const documentId=id(),eventId=id(),at=iso();
   const insert=select(`INSERT INTO fiscal_documents(
     id,kind,origin_type,origin_id,status,amount_cents,snapshot_json,
     snapshot_hash,request_id,created_at,updated_at
   ) VALUES(?,?,?,?,'RASCUNHO',?,?,?,?,?,?)`,[
     documentId,type,origin,orderId,amount,snapshot,hash,request,at,at
   ]);
   const event=select(`INSERT INTO fiscal_events(
     id,document_id,event_type,details_json,created_at
   ) VALUES(?,?,'CRIADO',?,?)`,[
     eventId,documentId,JSON.stringify({snapshotHash:hash}),at
   ]);
   await atomic(port,[insert,event]);
   return port.first('SELECT * FROM fiscal_documents WHERE id=?',[documentId]);
 }
 return Object.freeze({
   createCustomer,createMachine,createWorkOrder,getWorkOrder,
   createPart,postStockMovement,receivePayment,financeSummary,
   transitionWorkOrder,saveQuote,approveQuote,createFiscalDraft,
   ...createAsyncWorkshopCatalog(port),
   ...createAsyncWorkshopSales(port),
   ...createAsyncWorkshopOperations(port),
   ...createAsyncWorkshopFiscal(port,{provider:fiscalProvider}),
   ...createAsyncWorkshopFinance(port),
   ...createAsyncWorkshopOrders(port,{createWorkOrder,transitionWorkOrder,getWorkOrder}),
   ...createAsyncWorkshopInventory(port),
   ...createAsyncWorkshopAutomotive(port),
   ...createAsyncWorkshopAuth(port),
   ...createAsyncWorkshopCrm(port),
   ...createAsyncWorkshopAttachments(port,{objectStore})
 });
}
