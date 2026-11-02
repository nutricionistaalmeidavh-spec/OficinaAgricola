import { nowIso } from '../db.js';

const positiveCents=(v)=>{
 const n=Number(v);
 if(!Number.isSafeInteger(n)||n<=0)throw new Error('Valor financeiro inválido');
 return n;
};
const text=v=>v==null?'':String(v).trim();

export function activeCashSession(db){
 const has=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cash_sessions'").get();
 if(!has)return null;
 return db.prepare("SELECT id FROM cash_sessions WHERE status='ABERTO' ORDER BY id DESC LIMIT 1").get()||null;
}

export function activeCashForMethod(db,method){
 const cash=activeCashSession(db);
 if(text(method).toUpperCase()==='DINHEIRO'&&!cash)throw new Error('Abra o caixa para receber ou estornar dinheiro');
 return cash;
}

// Único escritor para cash_movements (vendas, recebimentos OS e ajuste manual).
export function postCashMovement(db,{
 cashSessionId,type,amountCents,paymentMethod='DINHEIRO',saleId=null,receiptId=null,
 note='',createdBy=null,createdAt=nowIso(),
}){
 const amount=Number(amountCents);
 if(!Number.isSafeInteger(amount)||amount===0)throw new Error('Valor de caixa inválido');
 const allowed=new Set(['VENDA','ESTORNO','SUPRIMENTO','SANGRIA','AJUSTE']);
 if(!allowed.has(type))throw new Error('Tipo de caixa inválido');
 const cash=db.prepare("SELECT id FROM cash_sessions WHERE id=? AND status='ABERTO'").get(cashSessionId);
 if(!cash)throw new Error('Abra o caixa antes de registrar esta operação');
 const z=db.prepare(`INSERT INTO cash_movements(
   cash_session_id,sale_id,receipt_id,type,amount_cents,payment_method,note,created_by,created_at
 ) VALUES(?,?,?,?,?,?,?,?,?)`).run(cash.id,saleId,receiptId,type,amount,text(paymentMethod),text(note),createdBy,createdAt);
 return Number(z.lastInsertRowid);
}

// Origem transacional única para receita e reversão. Nunca registrar dinheiro
// diretamente em vendas/financeiro: ambos enviam o comando a este serviço.
export function postPaymentEvent(db,{
 sourceType,sourceId,eventType,amountCents,method,
 cashSessionId=null,createdBy=null,note='',createdAt=nowIso()
}){
 if(!['SALE','OS_RECEIPT'].includes(sourceType)||!['PAID','REFUNDED'].includes(eventType))
   throw new Error('Origem financeira inválida');
 const sid=Number(sourceId);
 if(!Number.isSafeInteger(sid)||sid<1)throw new Error('ID financeiro inválido');
 const value=positiveCents(amountCents);
 const paymentMethod=text(method);
 if(!paymentMethod)throw new Error('Forma de pagamento é obrigatória');
 if(paymentMethod.toUpperCase()==='DINHEIRO'&&!cashSessionId)
   throw new Error('Abra o caixa antes de registrar dinheiro');
 const signed=eventType==='REFUNDED'?-value:value;
 const inserted=db.prepare(`INSERT INTO payment_events(
   source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at
 ) VALUES(?,?,?,?,?,?,?)`).run(sourceType,sid,eventType,signed,paymentMethod,cashSessionId,createdAt);
 if(cashSessionId!=null)postCashMovement(db,{
   cashSessionId,type:eventType==='PAID'?'VENDA':'ESTORNO',
   amountCents:signed,paymentMethod,
   saleId:sourceType==='SALE'?sid:null,
   receiptId:sourceType==='OS_RECEIPT'?sid:null,
   note,createdBy,createdAt,
 });
 return {id:Number(inserted.lastInsertRowid),amountCents:signed};
}
