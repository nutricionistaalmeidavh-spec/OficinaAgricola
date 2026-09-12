import { nowIso, transaction } from '../db.js';
import { paymentState } from '../domain.js';
import { getWorkOrder } from './work-orders.js';

const text=(v)=>v==null?'':String(v).trim();
const cents=(v,label='Valor')=>{const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error(`${label} inválido`);return n};

export function getPaymentSummary(db,workOrderId){
  const os=getWorkOrder(db,workOrderId); const received=Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) total FROM receipts WHERE work_order_id=? AND reversed_at IS NULL').get(workOrderId).total);
  const state=paymentState(Number(os.quote_total_cents||0),received); return {totalCents:Number(os.quote_total_cents||0),...state};
}
export function addReceipt(db,workOrderId,input){
  return transaction(db,()=>{
    const summary=getPaymentSummary(db,workOrderId); if(summary.totalCents<=0)throw new Error('OS não possui valor aprovado');
    const amount=cents(input.amountCents,'Valor do recebimento'); if(amount>summary.pendingCents)throw new Error('Valor excede o saldo pendente');
    const method=text(input.method); if(!method)throw new Error('Forma de pagamento é obrigatória');
    const receivedAt=input.receivedAt?new Date(input.receivedAt).toISOString():nowIso();
    const r=db.prepare('INSERT INTO receipts(work_order_id,amount_cents,method,received_at,note,created_by) VALUES(?,?,?,?,?,?)').run(workOrderId,amount,method,receivedAt,text(input.note),input.createdBy??null);
    return db.prepare('SELECT * FROM receipts WHERE id=?').get(Number(r.lastInsertRowid));
  });
}
export function reverseReceipt(db,workOrderId,receiptId,{note=''}={}){
  return transaction(db,()=>{
    getWorkOrder(db,workOrderId); const row=db.prepare('SELECT * FROM receipts WHERE id=? AND work_order_id=?').get(receiptId,workOrderId); if(!row)throw new Error('Recebimento não encontrado'); if(row.reversed_at)throw new Error('Recebimento já estornado');
    const t=nowIso(); db.prepare('UPDATE receipts SET reversed_at=?,reversal_note=? WHERE id=?').run(t,text(note),receiptId); return {...row,reversed_at:t,reversal_note:text(note)};
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
  const received=Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) total FROM receipts WHERE reversed_at IS NULL AND received_at BETWEEN ? AND ?`).get(from,to).total);
  const expenses=Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) total FROM expenses WHERE paid_at IS NOT NULL AND paid_at BETWEEN ? AND ?`).get(from,to).total);
  const approvedIds=db.prepare(`SELECT work_order_id FROM quotes WHERE approval_status='APROVADO' AND approved_at BETWEEN ? AND ?`).all(from,to).map(r=>r.work_order_id);
  let pending=0; for(const id of approvedIds) pending+=getPaymentSummary(db,id).pendingCents;
  return {invoicedCents:invoiced,receivedCents:received,pendingCents:pending,expensesCents:expenses,resultCents:received-expenses};
}
