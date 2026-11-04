import {createHash,randomBytes} from 'node:crypto';

const id=()=>randomBytes(6).readUIntBE(0,6);
const clean=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const positive=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};
const money=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)fail('Valor monetário inválido');return n;};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const query=(sql,params=[])=>({sql,params});
const count=result=>Number(result?.changes??result?.meta?.changes??0);
export function createAsyncWorkshopFinance(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador financeiro inválido');
 const isD1=port.engine==='d1';
 async function atomic(statements){
   if(isD1)return port.batch(statements);
   return port.transaction(async tx=>{
     const result=[];for(const s of statements)result.push(await tx.run(s.sql,s.params));
     return result;
   });
 }
 async function expense(expenseId){
   const value=await port.first('SELECT * FROM expenses WHERE id=?',[positive(expenseId)]);
   if(!value)fail('Despesa não encontrada',404);
   return value;
 }
 function normalizedExpense(input){
   const description=clean(input.description);
   if(!description)fail('Descrição da despesa é obrigatória');
   const amount=money(input.amountCents);
   const paidAt=input.paidAt?new Date(input.paidAt).toISOString():null;
   return {description,amount,category:clean(input.category),dueDate:input.dueDate??null,
     paidAt,referenceCenter:clean(input.referenceCenter),
     workOrderId:input.workOrderId==null?null:positive(input.workOrderId),note:clean(input.note)};
 }
 async function createExpense(input={}){
   const data=normalizedExpense(input),requestId=clean(input.requestId);
   if(requestId.length>128)fail('Identificador da despesa excede limite');
   const fingerprint=hash(data);
   const scope='finance:expenses';
   const prior=requestId?await port.first('SELECT * FROM command_idempotency WHERE scope=? AND request_id=?',
     [scope,requestId]):null;
   if(prior){
     if(prior.payload_hash!==fingerprint)fail('Identificador da despesa usado com outros dados',409);
     return expense(JSON.parse(prior.result_json).id);
   }
   if(data.workOrderId&&!await port.first('SELECT id FROM work_orders WHERE id=?',[data.workOrderId]))
     fail('OS não encontrada',404);
   const at=now(),expenseId=id();
   const commands=[
     query(`INSERT INTO expenses(id,description,category,amount_cents,due_date,
       paid_at,reference_center,work_order_id,note,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[
       expenseId,data.description,data.category,data.amount,data.dueDate,
       data.paidAt,data.referenceCenter,data.workOrderId,data.note,at,at
     ])
   ];
   if(requestId)commands.push(query(`INSERT INTO command_idempotency(
     scope,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)`,[
     scope,requestId,fingerprint,JSON.stringify({id:expenseId}),at
   ]));
   try{await atomic(commands);}
   catch(error){
     if(requestId){
       const next=await port.first('SELECT * FROM command_idempotency WHERE scope=? AND request_id=?',
         [scope,requestId]);
       if(next){
         if(next.payload_hash!==fingerprint)fail('Identificador da despesa usado com outros dados',409);
         return expense(JSON.parse(next.result_json).id);
       }
     }
     throw error;
   }
   return expense(expenseId);
 }
 async function updateExpense(expenseId,input={}){
   const old=await expense(expenseId);
   const data=normalizedExpense({
     description:input.description===undefined?old.description:input.description,
     amountCents:input.amountCents===undefined?old.amount_cents:input.amountCents,
     category:input.category===undefined?old.category:input.category,
     dueDate:input.dueDate===undefined?old.due_date:input.dueDate,
     paidAt:input.paidAt===undefined?old.paid_at:input.paidAt,
     referenceCenter:input.referenceCenter===undefined?old.reference_center:input.referenceCenter,
     workOrderId:input.workOrderId===undefined?old.work_order_id:input.workOrderId,
     note:input.note===undefined?old.note:input.note
   });
   if(data.workOrderId&&!await port.first('SELECT id FROM work_orders WHERE id=?',[data.workOrderId]))
     fail('OS não encontrada',404);
   await port.run(`UPDATE expenses SET description=?,category=?,amount_cents=?,
     due_date=?,paid_at=?,reference_center=?,work_order_id=?,note=?,updated_at=? WHERE id=?`,[
     data.description,data.category,data.amount,data.dueDate,data.paidAt,
     data.referenceCenter,data.workOrderId,data.note,now(),positive(expenseId)
   ]);
   return expense(expenseId);
 }
 async function listExpenses({from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z'}={}){
   return port.all(`SELECT e.*,wo.os_number FROM expenses e
     LEFT JOIN work_orders wo ON wo.id=e.work_order_id
     WHERE COALESCE(e.paid_at,e.due_date||'T00:00:00.000Z',e.created_at)
       BETWEEN ? AND ?
     ORDER BY COALESCE(e.paid_at,e.due_date,e.created_at) DESC,e.id DESC`,[from,to]);
 }
 async function listReceipts(workOrderId){
   return port.all('SELECT * FROM receipts WHERE work_order_id=? ORDER BY received_at DESC,id DESC',
     [positive(workOrderId)]);
 }
 async function getPaymentSummary(workOrderId){
   const order=await port.first('SELECT status,quote_total_cents FROM work_orders WHERE id=?',
     [positive(workOrderId)]);
   if(!order)fail('OS não encontrada',404);
   const r=await port.first(`SELECT COALESCE(SUM(amount_cents),0) amount
     FROM receipts WHERE work_order_id=? AND reversed_at IS NULL`,[positive(workOrderId)]);
   const receivedCents=Number(r.amount),totalCents=Number(order.quote_total_cents??0);
   if(order.status==='CANCELADA')return{
     totalCents,receivedCents,pendingCents:0,status:'CANCELADO'
   };
   const pendingCents=Math.max(0,totalCents-receivedCents);
   return {totalCents,receivedCents,pendingCents,
     status:totalCents<=0?'SEM_ORCAMENTO':pendingCents===0?'PAGO':receivedCents?'PARCIAL':'PENDENTE'};
 }
 async function reverseReceipt({workOrderId,receiptId,note=''}={}){
   const osId=positive(workOrderId),rId=positive(receiptId);
   const receipt=await port.first('SELECT * FROM receipts WHERE id=? AND work_order_id=?',
     [rId,osId]);
   if(!receipt)fail('Recebimento não encontrado',404);
   if(receipt.reversed_at)fail('Recebimento já estornado',409);
   const cash=await port.first(`SELECT id FROM cash_sessions WHERE status='ABERTO'
     ORDER BY id DESC LIMIT 1`);
   if(clean(receipt.method).toUpperCase()==='DINHEIRO'&&!cash)
     fail('Abra o caixa para estornar recebimento em dinheiro',409);
   const at=now(),reason=clean(note),eventId=id();
   const update=query(`UPDATE receipts SET reversed_at=?,reversal_note=?
     WHERE id=? AND work_order_id=? AND reversed_at IS NULL`,[at,reason,rId,osId]);
   const payment=query(`INSERT INTO payment_events(
     id,source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at)
     SELECT ?,'OS_RECEIPT',?,'REFUNDED',?,?,?,? FROM receipts WHERE id=? AND reversed_at=?`,[
     eventId,rId,-Number(receipt.amount_cents),receipt.method,cash?.id??null,at,rId,at
   ]);
   const movements=[update,payment];
   if(cash)movements.push(query(`INSERT INTO cash_movements(
     id,cash_session_id,receipt_id,type,amount_cents,payment_method,note,created_at)
     SELECT ?,? ,?,'ESTORNO',?,?,?,? FROM receipts WHERE id=? AND reversed_at=?`,[
       id(),cash.id,rId,-Number(receipt.amount_cents),receipt.method,
       'Estorno recebimento OS '+osId,at,rId,at
     ]));
   if(isD1){
     const results=await port.batch(movements);
     if(count(results[0])!==1)fail('Recebimento já estornado',409);
   }else await port.transaction(async tx=>{
     if(port.engine==='postgres'){
       const current=await tx.first('SELECT id FROM receipts WHERE id=? FOR UPDATE',[rId]);
       if(!current)fail('Recebimento não encontrado',404);
     }
     const res=await tx.run(update.sql,update.params);
     if(count(res)!==1)fail('Recebimento já estornado',409);
     for(const entry of movements.slice(1))await tx.run(entry.sql,entry.params);
   });
   return port.first('SELECT * FROM receipts WHERE id=?',[rId]);
 }
 return Object.freeze({createExpense,updateExpense,getExpense:expense,listExpenses,
   listReceipts,getPaymentSummary,reverseReceipt});
}
