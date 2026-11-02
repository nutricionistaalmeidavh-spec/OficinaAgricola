import { calculateQuote, assertTransition } from '../domain.js';
import { nowIso, transaction } from '../db.js';
import { getWorkOrder } from './work-orders.js';

const KINDS=new Set(['PECA','MAO_DE_OBRA','TERCEIRO']);
const text=(v)=>v==null?'':String(v).trim();

function setStatus(db, os, to, reason=''){
  assertTransition(os.status,to); const t=nowIso();
  db.prepare('UPDATE work_orders SET status=?,updated_at=? WHERE id=?').run(to,t,os.id);
  db.prepare('INSERT INTO work_order_status_history(work_order_id,from_status,to_status,reason,changed_at) VALUES(?,?,?,?,?)').run(os.id,os.status,to,reason,t);
  return {...os,status:to};
}

export function getQuote(db,workOrderId){
  const q=db.prepare('SELECT * FROM quotes WHERE work_order_id=?').get(workOrderId); if(!q) throw new Error('Orçamento não encontrado');
  return {...q,items:db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id').all(q.id)};
}

export function saveQuote(db,workOrderId,input){
  return transaction(db,()=>{
    let os=getWorkOrder(db,workOrderId);
    if(['APROVADA','EM_SERVICO','PRONTA','ENTREGUE','CANCELADA'].includes(os.status)) throw new Error('Orçamento não pode ser alterado neste status');
    if(os.status==='DIAGNOSTICO') os=setStatus(db,os,'ORCAMENTO','Orçamento iniciado');
    else if(os.status==='REPROVADA') os=setStatus(db,os,'ORCAMENTO','Orçamento revisado');
    if(os.status!=='ORCAMENTO' && os.status!=='AGUARDANDO_APROVACAO') throw new Error('OS não está pronta para orçamento');
    const items=(input.items??[]).map((item)=>{
      if(!KINDS.has(item.kind)||!text(item.description)) throw new Error('Item de orçamento inválido');
      const quantity=Number(item.quantity); const unitPriceCents=Number(item.unitPriceCents);
      if(!Number.isFinite(quantity)||quantity<=0||!Number.isInteger(unitPriceCents)||unitPriceCents<0) throw new Error('Item de orçamento inválido');
      return {kind:item.kind,description:text(item.description),quantity,unitPriceCents,totalCents:Math.round(quantity*unitPriceCents)};
    });
    const totals=calculateQuote(items,Number(input.discountCents??0)); const t=nowIso();
    let quote=db.prepare('SELECT * FROM quotes WHERE work_order_id=?').get(workOrderId);
    if(quote){
      if(quote.approval_status==='APROVADO') throw new Error('Orçamento aprovado não pode ser editado');
      db.prepare(`UPDATE quotes SET subtotal_cents=?,discount_cents=?,total_cents=?,notes=?,valid_until=?,approval_status='RASCUNHO',rejection_reason='',approved_at=NULL,rejected_at=NULL,updated_at=? WHERE id=?`)
        .run(totals.subtotalCents,totals.discountCents,totals.totalCents,text(input.notes),input.validUntil??null,t,quote.id);
      db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(quote.id);
    } else {
      const r=db.prepare(`INSERT INTO quotes(work_order_id,subtotal_cents,discount_cents,total_cents,notes,valid_until,approval_status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'RASCUNHO',?,?)`)
        .run(workOrderId,totals.subtotalCents,totals.discountCents,totals.totalCents,text(input.notes),input.validUntil??null,t,t);
      quote={id:Number(r.lastInsertRowid)};
    }
    const ins=db.prepare('INSERT INTO quote_items(quote_id,kind,description,quantity,unit_price_cents,total_cents) VALUES(?,?,?,?,?,?)');
    for(const item of items) ins.run(quote.id,item.kind,item.description,item.quantity,item.unitPriceCents,item.totalCents);
    return getQuote(db,workOrderId);
  });
}

export function submitQuote(db,workOrderId){
  return transaction(db,()=>{
    let os=getWorkOrder(db,workOrderId); const q=getQuote(db,workOrderId);
    if(os.status!=='ORCAMENTO') throw new Error('OS não está em orçamento');
    os=setStatus(db,os,'AGUARDANDO_APROVACAO','Orçamento enviado para aprovação');
    db.prepare("UPDATE quotes SET approval_status='AGUARDANDO',updated_at=? WHERE id=?").run(nowIso(),q.id);
    return getQuote(db,workOrderId);
  });
}

export function approveQuote(db,workOrderId){
  return transaction(db,()=>{
    let os=getWorkOrder(db,workOrderId); const q=getQuote(db,workOrderId);
    if(!['ORCAMENTO','AGUARDANDO_APROVACAO'].includes(os.status)) throw new Error('OS não aguarda aprovação');
    os=setStatus(db,os,'APROVADA','Orçamento aprovado'); const t=nowIso();
    db.prepare("UPDATE quotes SET approval_status='APROVADO',approved_at=?,updated_at=? WHERE id=?").run(t,t,q.id);
    db.prepare('UPDATE work_orders SET quote_total_cents=?,updated_at=? WHERE id=?').run(q.total_cents,t,workOrderId);
    return getQuote(db,workOrderId);
  });
}

export function rejectQuote(db,workOrderId,reason){
  return transaction(db,()=>{
    let os=getWorkOrder(db,workOrderId); const q=getQuote(db,workOrderId); const why=text(reason);
    if(!why) throw new Error('Motivo da reprovação é obrigatório');
    if(!['ORCAMENTO','AGUARDANDO_APROVACAO'].includes(os.status)) throw new Error('OS não aguarda aprovação');
    os=setStatus(db,os,'REPROVADA',why); const t=nowIso();
    db.prepare("UPDATE quotes SET approval_status='REPROVADO',rejection_reason=?,rejected_at=?,updated_at=? WHERE id=?").run(why,t,t,q.id);
    return getQuote(db,workOrderId);
  });
}
