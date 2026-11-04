// Auditoria somente leitura: NUNCA corrige saldos silenciosamente.
export function auditInvariants(db,{batchSize=null,cursors={}}={}){
 const limit=Number.isSafeInteger(batchSize)&&batchSize>0?Math.min(batchSize,1000):2147483647;
 const after={
  stock:Number(cursors.stock)||0,
  receipts:Number(cursors.receipts)||0,
  sales:Number(cursors.sales)||0,
  cash:Number(cursors.cash)||0
 };
 const errors=[];
 const add=(scope,id,message,expected,actual)=>errors.push({scope,id,message,expected,actual});
 const stock=db.prepare(`SELECT p.id,p.sku,p.quantity,COALESCE(SUM(im.quantity_delta),0) ledger
   FROM parts p LEFT JOIN inventory_movements im ON im.part_id=p.id WHERE p.id>? GROUP BY p.id ORDER BY p.id LIMIT ?`).all(after.stock,limit);
 for(const p of stock){
   if(Math.abs(Number(p.quantity)-Number(p.ledger))>1e-7)
     add('STOCK',p.id,'Saldo materializado diverge do livro de estoque',p.ledger,p.quantity);
 }
 const receipts=db.prepare(`SELECT r.*,COALESCE(SUM(CASE WHEN pe.event_type='PAID' THEN pe.amount_cents ELSE 0 END),0) paid,
   COALESCE(SUM(CASE WHEN pe.event_type='REFUNDED' THEN pe.amount_cents ELSE 0 END),0) refunded
   FROM receipts r LEFT JOIN payment_events pe ON pe.source_type='OS_RECEIPT' AND pe.source_id=r.id
   WHERE r.id>? GROUP BY r.id ORDER BY r.id LIMIT ?`).all(after.receipts,limit);
 for(const r of receipts){
   if(Number(r.paid)!==Number(r.amount_cents))add('RECEIPT',r.id,'Falta pagamento ou valor divergente',r.amount_cents,r.paid);
   const expectedRefund=r.reversed_at?-r.amount_cents:0;
   if(Number(r.refunded)!==Number(expectedRefund))add('RECEIPT',r.id,'Estorno ausente ou inesperado',expectedRefund,r.refunded);
 }
 let salesRows=[];
 const salesExists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales'").get();
 if(salesExists){
   const sales=db.prepare(`SELECT s.*,
     COALESCE(SUM(CASE WHEN pe.event_type='PAID' THEN pe.amount_cents ELSE 0 END),0) paid,
     COALESCE(SUM(CASE WHEN pe.event_type='REFUNDED' THEN pe.amount_cents ELSE 0 END),0) refunded
     FROM sales s LEFT JOIN payment_events pe ON pe.source_type='SALE' AND pe.source_id=s.id
     WHERE s.id>? GROUP BY s.id ORDER BY s.id LIMIT ?`).all(after.sales,limit);
   salesRows=sales;
   for(const s of sales){
     if(Number(s.paid)!==Number(s.total_cents))add('SALE',s.id,'Venda diverge do evento de pagamento',s.total_cents,s.paid);
     const expectedRefund=s.status==='CANCELADA'?-s.total_cents:0;
     if(Number(s.refunded)!==Number(expectedRefund))add('SALE',s.id,'Estorno de venda divergente',expectedRefund,s.refunded);
   }
 }
 let cashRows=[];
 const cashExists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cash_movements'").get();
 if(cashExists){
   const items=db.prepare(`SELECT pe.*,cm.amount_cents drawer_amount,cm.id drawer_id
     FROM payment_events pe LEFT JOIN cash_movements cm ON cm.cash_session_id=pe.cash_session_id
       AND cm.type=CASE WHEN pe.event_type='PAID' THEN 'VENDA' ELSE 'ESTORNO' END
       AND ((pe.source_type='SALE' AND cm.sale_id=pe.source_id)
            OR (pe.source_type='OS_RECEIPT' AND cm.receipt_id=pe.source_id))
     WHERE pe.cash_session_id IS NOT NULL AND pe.id>? ORDER BY pe.id LIMIT ?`).all(after.cash,limit);
   cashRows=items;
   for(const p of items)
     if(p.drawer_id==null||Number(p.drawer_amount)!==Number(p.amount_cents))
       add('CASH',p.id,'Projeção do caixa diverge do evento financeiro',p.amount_cents,p.drawer_amount);
 }
 const advance=(rows,previous)=>rows.length>=limit&&rows.length?rows.at(-1).id:0;
 return {ok:errors.length===0,checked:{stock:stock.length,receipts:receipts.length},
   errors,nextCursor:{
    stock:advance(stock,after.stock),receipts:advance(receipts,after.receipts),
    sales:advance(salesRows,after.sales),
    cash:advance(cashRows,after.cash)
   }};
}
