import { createHash } from 'node:crypto';
import { nowIso, transaction } from '../db.js';
import { activeCashForMethod, postPaymentEvent } from './payment-ledger.js';
import { paymentState } from '../domain.js';
import { getWorkOrder } from './work-orders.js';

const text=(v)=>v==null?'':String(v).trim();
const cents=(v,label='Valor')=>{const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error(`${label} inválido`);return n};

export function getPaymentSummary(db,workOrderId){
  const os=getWorkOrder(db,workOrderId); const received=Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) total FROM receipts WHERE work_order_id=? AND reversed_at IS NULL').get(workOrderId).total);
  const state=paymentState(Number(os.quote_total_cents||0),received); return {totalCents:Number(os.quote_total_cents||0),...state};
}
function receiptFingerprint(workOrderId,input) {
 return createHash('sha256').update(JSON.stringify({
   workOrderId:Number(workOrderId),amountCents:Number(input.amountCents),
   method:text(input.method),note:text(input.note),
   receivedAt:input.receivedAt?new Date(input.receivedAt).toISOString():null
 })).digest('hex');
}
export function addReceipt(db,workOrderId,input){
 const requestId=text(input.requestId);
 if(requestId.length>128)throw new Error('Identificador de recebimento excede limite');
 const fingerprint=requestId?receiptFingerprint(workOrderId,input):null;
 return transaction(db,()=>{
   if(requestId){
     const existing=db.prepare('SELECT * FROM receipts WHERE request_id=?').get(requestId);
     if(existing){
       if(existing.request_payload_hash!==fingerprint)throw new Error('Identificador de recebimento já utilizado com dados diferentes');
       return existing;
     }
   }
   const summary=getPaymentSummary(db,workOrderId);
   if(summary.totalCents<=0)throw new Error('OS não possui valor aprovado');
   const amount=cents(input.amountCents,'Valor do recebimento');
   if(amount>summary.pendingCents)throw new Error('Valor excede o saldo pendente');
   const method=text(input.method);
   if(!method)throw new Error('Forma de pagamento é obrigatória');
   const cash=activeCashForMethod(db,method);
   const receivedAt=input.receivedAt?new Date(input.receivedAt).toISOString():nowIso();
   const r=db.prepare(`INSERT INTO receipts(
     work_order_id,amount_cents,method,received_at,note,created_by,request_id,request_payload_hash
   ) VALUES(?,?,?,?,?,?,?,?)`).run(workOrderId,amount,method,receivedAt,text(input.note),
     input.createdBy??null,requestId||null,fingerprint);
   const receiptId=Number(r.lastInsertRowid);
   postPaymentEvent(db,{sourceType:'OS_RECEIPT',sourceId:receiptId,eventType:'PAID',
     amountCents:amount,method,cashSessionId:cash?.id||null,createdAt:receivedAt,
     createdBy:input.createdBy??null,note:`Recebimento OS #${workOrderId}`});
   return db.prepare('SELECT * FROM receipts WHERE id=?').get(receiptId);
 });
}
export function reverseReceipt(db,workOrderId,receiptId,{note='',createdBy=null}={}){
 return transaction(db,()=>{
   getWorkOrder(db,workOrderId);
   const row=db.prepare('SELECT * FROM receipts WHERE id=? AND work_order_id=?').get(receiptId,workOrderId);
   if(!row)throw new Error('Recebimento não encontrado');
   if(row.reversed_at)throw new Error('Recebimento já estornado');
   const cash=activeCashForMethod(db,row.method);
   const t=nowIso();
   db.prepare('UPDATE receipts SET reversed_at=?,reversal_note=? WHERE id=?').run(t,text(note),receiptId);
   postPaymentEvent(db,{sourceType:'OS_RECEIPT',sourceId:receiptId,eventType:'REFUNDED',
     amountCents:row.amount_cents,method:row.method,cashSessionId:cash?.id||null,
     createdBy,note:`Estorno recebimento OS #${workOrderId}`,createdAt:t});
   return {...row,reversed_at:t,reversal_note:text(note)};
 });
}

export function listReceipts(db,workOrderId){return db.prepare('SELECT * FROM receipts WHERE work_order_id=? ORDER BY received_at DESC,id DESC').all(workOrderId)}

export function createExpense(db,input){
  const description=text(input.description); if(!description)throw new Error('Descrição da despesa é obrigatória'); const amount=cents(input.amountCents,'Valor da despesa'); if(input.workOrderId)getWorkOrder(db,input.workOrderId);
  const t=nowIso(); const r=db.prepare(`INSERT INTO expenses(description,category,amount_cents,due_date,paid_at,reference_center,work_order_id,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(description,text(input.category),amount,input.dueDate??null,input.paidAt?new Date(input.paidAt).toISOString():null,text(input.referenceCenter),input.workOrderId??null,text(input.note),t,t);
  return getExpense(db,Number(r.lastInsertRowid));
}
export function getExpense(db,id){const e=db.prepare('SELECT * FROM expenses WHERE id=?').get(id);if(!e)throw new Error('Despesa não encontrada');return e}
export function updateExpense(db,id,input){
  const old=getExpense(db,id); if(input.workOrderId)getWorkOrder(db,input.workOrderId);
  db.prepare(`UPDATE expenses SET description=?,category=?,amount_cents=?,due_date=?,paid_at=?,reference_center=?,work_order_id=?,note=?,updated_at=? WHERE id=?`).run(
    input.description===undefined?old.description:text(input.description),input.category===undefined?old.category:text(input.category),input.amountCents===undefined?old.amount_cents:cents(input.amountCents,'Valor da despesa'),input.dueDate===undefined?old.due_date:input.dueDate,
    input.paidAt===undefined?old.paid_at:(input.paidAt?new Date(input.paidAt).toISOString():null),input.referenceCenter===undefined?old.reference_center:text(input.referenceCenter),input.workOrderId===undefined?old.work_order_id:input.workOrderId,input.note===undefined?old.note:text(input.note),nowIso(),id);
  return getExpense(db,id);
}
export function listExpenses(db,{from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z'}={}){
  return db.prepare(`SELECT e.*,wo.os_number FROM expenses e LEFT JOIN work_orders wo ON wo.id=e.work_order_id WHERE COALESCE(e.paid_at,e.due_date||'T00:00:00.000Z',e.created_at) BETWEEN ? AND ? ORDER BY COALESCE(e.paid_at,e.due_date,e.created_at) DESC`).all(from,to);
}
export function financeSummary(db,{from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z'}={}){
  const invoiced=Number(db.prepare(`SELECT COALESCE(SUM(q.total_cents),0) total FROM quotes q WHERE q.approval_status='APROVADO' AND q.approved_at BETWEEN ? AND ?`).get(from,to).total);
  // Balcão e OS são operações distintas; venda ligada à OS é rejeitada pela API.
  // Nunca inferir venda balcão a partir de um item já consumido em OS.
  const hasSales=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales'").get();
  const posInvoiced=hasSales?Number(db.prepare(`
    SELECT COALESCE(SUM(total_cents),0) total FROM sales
    WHERE status='CONCLUIDA' AND created_at BETWEEN ? AND ?
  `).get(from,to).total):0;
  const received=Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) total FROM payment_events WHERE created_at BETWEEN ? AND ?`).get(from,to).total);
  const expenses=Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) total FROM expenses WHERE paid_at IS NOT NULL AND paid_at BETWEEN ? AND ?`).get(from,to).total);
  const approvedIds=db.prepare(`SELECT work_order_id FROM quotes WHERE approval_status='APROVADO' AND approved_at BETWEEN ? AND ?`).all(from,to).map(r=>r.work_order_id);
  let pending=0; for(const id of approvedIds) pending+=getPaymentSummary(db,id).pendingCents;
  return {invoicedCents:invoiced+posInvoiced,receivedCents:received,pendingCents:pending,expensesCents:expenses,resultCents:received-expenses};
}
