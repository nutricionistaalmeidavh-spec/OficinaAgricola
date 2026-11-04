import {selectPage} from '../platform/pagination.js';
import { createHash } from 'node:crypto';
import { nowIso, transaction } from '../db.js';
import { activeCashForMethod, postPaymentEvent } from './payment-ledger.js';
import {runIdempotent} from '../platform/idempotency.js';
import { paymentState } from '../domain.js';
import { getWorkOrder } from './work-orders.js';

const text=(v)=>v==null?'':String(v).trim();
const cents=(v,label='Valor')=>{const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error(`${label} inválido`);return n};

export function getPaymentSummary(db,workOrderId){
  const os=getWorkOrder(db,workOrderId); const received=Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) total FROM receipts WHERE work_order_id=? AND reversed_at IS NULL').get(workOrderId).total);
  const totalCents=Number(os.quote_total_cents||0);
  // Preserve o orçamento histórico, mas nunca exiba dívida em OS cancelada.
  if(os.status==='CANCELADA')return {totalCents,receivedCents:received,pendingCents:0,status:'CANCELADO'};
  const state=paymentState(totalCents,received); return {totalCents,...state};
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
   if(summary.status==='CANCELADO')throw new Error('OS não pode receber pagamento após cancelamento');
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
export function reverseReceipt(db,workOrderId,receiptId,{note='',createdBy=null,externalRefundId=null}={}){
 return transaction(db,()=>{
   getWorkOrder(db,workOrderId);
   const row=db.prepare('SELECT * FROM receipts WHERE id=? AND work_order_id=?').get(receiptId,workOrderId);
   if(!row)throw new Error('Recebimento não encontrado');
   if(row.reversed_at)throw new Error('Recebimento já estornado');
   const billingInstallment=db.prepare(`SELECT i.id,p.method FROM billing_installments i
     JOIN billing_plans p ON p.id=i.plan_id WHERE i.receipt_id=? AND i.status='PAID'`).get(receiptId);
   if(billingInstallment?.method!=='MANUAL'&&billingInstallment){
     const authorized=externalRefundId&&db.prepare(
       "SELECT id FROM billing_refunds WHERE id=? AND installment_id=? AND receipt_id=? AND amount_cents=? AND status='CONFIRMED'"
     ).get(externalRefundId,billingInstallment.id,receiptId,row.amount_cents);
     if(!authorized)throw new Error('Cobrança externa exige confirmação de estorno externo antes da baixa financeira');
   }
   if(db.prepare('SELECT id FROM billing_bank_entries WHERE receipt_id=?').get(receiptId))
     throw new Error('Extrato conciliado exige reconciliação antes do estorno');
   if(billingInstallment&&db.prepare('SELECT id FROM billing_settlements WHERE installment_id=?').get(billingInstallment.id))
     throw new Error('Repasse conciliado impede estorno da parcela até reconciliação');
   if(db.prepare("SELECT id FROM payment_intents WHERE receipt_id=? AND status='PAID'").get(receiptId))
     throw new Error('Cobrança do provedor exige confirmação de estorno externo antes da baixa financeira');
   const cash=activeCashForMethod(db,row.method);
   const t=nowIso();
   db.prepare('UPDATE receipts SET reversed_at=?,reversal_note=? WHERE id=?').run(t,text(note),receiptId);
   postPaymentEvent(db,{sourceType:'OS_RECEIPT',sourceId:receiptId,eventType:'REFUNDED',
     amountCents:row.amount_cents,method:row.method,cashSessionId:cash?.id||null,
     createdBy,note:`Estorno recebimento OS #${workOrderId}`,createdAt:t});
   if(billingInstallment?.method!=='MANUAL'&&billingInstallment)
     db.prepare("UPDATE billing_installments SET status='FAILED',updated_at=? WHERE id=? AND receipt_id=? AND status='PAID'")
       .run(t,billingInstallment.id,receiptId);
   if(billingInstallment?.method==='MANUAL')
     db.prepare(`UPDATE billing_installments SET status='PENDING',receipt_id=NULL,
       attempt_no=attempt_no+1,updated_at=? WHERE id=? AND status='PAID'`)
       .run(t,billingInstallment.id);
   return {...row,reversed_at:t,reversal_note:text(note)};
 });
}

export function listReceipts(db,workOrderId){return db.prepare('SELECT * FROM receipts WHERE work_order_id=? ORDER BY received_at DESC,id DESC').all(workOrderId)}

export function createExpense(db,input){
  const {requestId,...command}=input;
  return runIdempotent(db,'finance:expenses',requestId,command,()=>{
    const description=text(command.description);
    if(!description)throw new Error('Descrição da despesa é obrigatória');
    const amount=cents(command.amountCents,'Valor da despesa');
    if(command.workOrderId)getWorkOrder(db,command.workOrderId);
    const t=nowIso();
    const r=db.prepare(`INSERT INTO expenses(description,category,amount_cents,due_date,paid_at,reference_center,work_order_id,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(description,text(command.category),amount,command.dueDate??null,
        command.paidAt?new Date(command.paidAt).toISOString():null,text(command.referenceCenter),
        command.workOrderId??null,text(command.note),t,t);
    return getExpense(db,Number(r.lastInsertRowid));
  });
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
  const invoiced=Number(db.prepare(`SELECT COALESCE(SUM(q.total_cents),0) total FROM quotes q JOIN work_orders wo ON wo.id=q.work_order_id WHERE q.approval_status='APROVADO' AND wo.status<>'CANCELADA' AND q.approved_at BETWEEN ? AND ?`).get(from,to).total);
  // Balcão e OS são operações distintas; venda ligada à OS é rejeitada pela API.
  // Nunca inferir venda balcão a partir de um item já consumido em OS.
  const hasSales=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales'").get();
  const posInvoiced=hasSales?Number(db.prepare(`
    SELECT COALESCE(SUM(total_cents),0) total FROM sales
    WHERE status='CONCLUIDA' AND created_at BETWEEN ? AND ?
  `).get(from,to).total):0;
  const received=Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) total FROM payment_events WHERE created_at BETWEEN ? AND ?`).get(from,to).total);
  const expenses=Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) total FROM expenses WHERE paid_at IS NOT NULL AND paid_at BETWEEN ? AND ?`).get(from,to).total);
  // Agregação única: não executar duas consultas adicionais por OS aprovada.
  const pending=Number(db.prepare(`
    SELECT COALESCE(SUM(MAX(0,wo.quote_total_cents-
      COALESCE((SELECT SUM(r.amount_cents) FROM receipts r
                WHERE r.work_order_id=wo.id AND r.reversed_at IS NULL),0))),0) total
    FROM quotes q JOIN work_orders wo ON wo.id=q.work_order_id
    WHERE q.approval_status='APROVADO' AND wo.status<>'CANCELADA'
      AND q.approved_at BETWEEN ? AND ?
  `).get(from,to).total);
  return {invoicedCents:invoiced+posInvoiced,receivedCents:received,pendingCents:pending,expensesCents:expenses,resultCents:received-expenses};
}

export function listExpensesPage(db,{from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z',limit=50,cursor=null}={}){
  const sort="COALESCE(e.paid_at,e.due_date||'T00:00:00.000Z',e.created_at)";
  return selectPage(db,{from:'FROM expenses e LEFT JOIN work_orders wo ON wo.id=e.work_order_id',
    select:'e.*,wo.os_number',where:[sort+' BETWEEN ? AND ?'],args:[from,to],
    sort,id:'e.id',cursor,limit,scope:'expenses'});
}
