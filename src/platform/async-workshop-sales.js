import {createHash,randomBytes} from 'node:crypto';

const id=()=>randomBytes(6).readUIntBE(0,6);
const clean=v=>String(v??'').trim();
const fail=(s,status=400)=>{throw Object.assign(new Error(s),{status});};
const key=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};
const cents=v=>{const n=Number(v??0);if(!Number.isSafeInteger(n)||n<0)fail('Valor inválido');return n;};
const qty=v=>{const n=Number(v);if(!Number.isFinite(n)||n<=0||n>1000000)fail('Quantidade inválida');return n;};
const time=()=>new Date().toISOString();
const command=(sql,params=[])=>({sql,params});
const affected=v=>Number(v?.changes??v?.meta?.changes??0);
const fingerprint=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createAsyncWorkshopSales(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador SQL inválido');
 const isD1=port.engine==='d1';
 const lock=port.engine==='postgres'?' FOR UPDATE':'';
 async function openSession(){return port.first("SELECT * FROM cash_sessions WHERE status='ABERTO' ORDER BY id DESC LIMIT 1");}
 async function loadRequest(scope,requestId,hash){
   if(!requestId)return null;
   const row=await port.first('SELECT * FROM command_idempotency WHERE scope=? AND request_id=?',[scope,requestId]);
   if(!row)return null;
   if(row.payload_hash!==hash)fail('Identificador idempotente reutilizado com dados diferentes',409);
   return JSON.parse(row.result_json);
 }
 async function persistRequest(tx,scope,requestId,hash,result){
   if(!requestId)return;
   await tx.run('INSERT INTO command_idempotency(scope,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)',
     [scope,requestId,hash,JSON.stringify(result),time()]);
 }
 async function createService(input={}){
   const code=clean(input.code),name=clean(input.name);
   if(!code||!name)fail('Código e nome do serviço são obrigatórios');
   const serviceId=id(),at=time(),price=cents(input.priceCents??0);
   const minutes=Math.max(0,Number(input.estimatedMinutes||0));
   await port.run(`INSERT INTO service_catalog(
     id,code,name,description,price_cents,estimated_minutes,active,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,?,?)`,[
     serviceId,code,name,clean(input.description),price,minutes,input.active===false?0:1,at,at
   ]);
   return port.first('SELECT * FROM service_catalog WHERE id=?',[serviceId]);
 }
 async function listServices({includeInactive=false,search=''}={}){
   const q='%'+clean(search)+'%';
   return port.all(`SELECT * FROM service_catalog WHERE (?=1 OR active=1)
     AND (code LIKE ? OR name LIKE ? OR description LIKE ?) ORDER BY name`,
     [includeInactive?1:0,q,q,q]);
 }
 async function openCashSession(input={}){
   const opening=cents(input.openingCents??0),note=clean(input.note),requestId=clean(input.requestId);
   if(requestId.length>128)fail('Identificador do caixa excede limite');
   const hash=fingerprint({opening,note}),previous=await loadRequest('cash:open',requestId,hash);
   if(previous)return previous;
   const openedId=id(),at=time();
   const created=command(`INSERT INTO cash_sessions(
     id,opened_at,opening_cents,opened_by,status,notes
   ) SELECT ?,?,?,NULL,'ABERTO',?
     WHERE NOT EXISTS(SELECT 1 FROM cash_sessions WHERE status='ABERTO')`,[
     openedId,at,opening,note
   ]);
   const log=command(`INSERT INTO command_idempotency(scope,request_id,payload_hash,result_json,created_at)
     SELECT 'cash:open',?,?,?,? FROM cash_sessions WHERE id=?`,[
       requestId,hash,JSON.stringify({id:openedId,status:'ABERTO'}),at,openedId
   ]);
   try{
     if(isD1){
       const result=await port.batch(requestId?[created,log]:[created]);
       if(affected(result[0])!==1)fail('Já existe um caixa aberto',409);
     }else await port.transaction(async tx=>{
       const active=await tx.first("SELECT id FROM cash_sessions WHERE status='ABERTO' LIMIT 1"+lock);
       if(active)fail('Já existe um caixa aberto',409);
       const r=await tx.run(created.sql,created.params);
       if(affected(r)!==1)fail('Já existe um caixa aberto',409);
       if(requestId)await persistRequest(tx,'cash:open',requestId,hash,{id:openedId,status:'ABERTO'});
     });
   }catch(error){
     const replay=await loadRequest('cash:open',requestId,hash);
     if(replay)return port.first('SELECT * FROM cash_sessions WHERE id=?',[replay.id]);
     throw error;
   }
   return port.first('SELECT * FROM cash_sessions WHERE id=?',[openedId]);
 }
 async function cashSummary(){
   const session=await openSession();
   if(!session)return {session:null,movements:[],expectedCashCents:0,movementTotalCents:0,byMethod:[]};
   const movements=await port.all('SELECT * FROM cash_movements WHERE cash_session_id=? ORDER BY id DESC',[session.id]);
   const byMethod=await port.all(`SELECT payment_method,SUM(amount_cents) total_cents
     FROM cash_movements WHERE cash_session_id=? GROUP BY payment_method ORDER BY payment_method`,[session.id]);
   const movementTotalCents=movements.reduce((n,x)=>n+Number(x.amount_cents),0);
   const expectedCashCents=Number(session.opening_cents)+movements
     .filter(x=>x.payment_method==='DINHEIRO').reduce((n,x)=>n+Number(x.amount_cents),0);
   return {session,movements,expectedCashCents,movementTotalCents,byMethod};
 }
 async function closeCashSession({closingCents,note=''}={}){
   const closing=cents(closingCents),session=await openSession();
   if(!session)fail('Abra o caixa antes de fechar',409);
   const summary=await cashSummary(),at=time();
   const result=await port.run(`UPDATE cash_sessions SET status='FECHADO',closed_at=?,
     closing_cents=?,expected_cents=?,difference_cents=?,notes=?
     WHERE id=? AND status='ABERTO'`,[
     at,closing,summary.expectedCashCents,closing-summary.expectedCashCents,
     clean(note)||session.notes,session.id
   ]);
   if(affected(result)!==1)fail('Caixa alterado simultaneamente',409);
   return port.first('SELECT * FROM cash_sessions WHERE id=?',[session.id]);
 }
 async function getSale(saleId){
   const row=await port.first(`SELECT s.*,c.name customer_name FROM sales s
     LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?`,[key(saleId)]);
   if(!row)fail('Venda não encontrada',404);
   return {...row,items:await port.all(`SELECT si.*,p.sku,sc.code service_code
     FROM sale_items si LEFT JOIN parts p ON p.id=si.part_id
     LEFT JOIN service_catalog sc ON sc.id=si.service_id
     WHERE si.sale_id=? ORDER BY si.id`,[row.id])};
 }
 async function listSales({limit=100,search='',status=''}={}){
   const n=Math.max(1,Math.min(500,Number(limit)||100)),q='%'+clean(search)+'%';
   return port.all(`SELECT s.*,c.name customer_name FROM sales s
     LEFT JOIN customers c ON c.id=s.customer_id
     WHERE (CAST(s.sale_number AS TEXT) LIKE ? OR c.name LIKE ? OR ?='')
       AND (s.status=? OR ?='')
     ORDER BY s.id DESC LIMIT ?`,[q,q,clean(search),clean(status),clean(status),n]);
 }
 async function resolveItem(input){
   const quantity=qty(input.quantity),partId=input.partId==null?null:key(input.partId),
     serviceId=input.serviceId==null?null:key(input.serviceId);
   if(partId){
     const part=await port.first('SELECT * FROM parts WHERE id=? AND active=1',[partId]);
     if(!part)fail('Peça da venda não encontrada',404);
     const price=cents(input.unitPriceCents===undefined?part.sale_price_cents:input.unitPriceCents);
     if(input.expectedUnitPriceCents!==undefined&&cents(input.expectedUnitPriceCents)!==price)fail('Preço da peça alterado. Revise a prévia antes de concluir.',409);
     return {id:id(),kind:'PECA',partId,serviceId:null,description:clean(input.description)||part.description,
       quantity,price,total:Math.round(price*quantity)};
   }
   if(serviceId){
     const s=await port.first('SELECT * FROM service_catalog WHERE id=? AND active=1',[serviceId]);
     if(!s)fail('Serviço da venda não encontrado',404);
     const price=cents(input.unitPriceCents===undefined?s.price_cents:input.unitPriceCents);
     if(input.expectedUnitPriceCents!==undefined&&cents(input.expectedUnitPriceCents)!==price)fail('Preço do serviço alterado. Revise a prévia antes de concluir.',409);
     return {id:id(),kind:'SERVICO',partId:null,serviceId,description:clean(input.description)||s.name,
       quantity,price,total:Math.round(price*quantity)};
   }
   const description=clean(input.description);if(!description)fail('Descrição do item obrigatória');
   const price=cents(input.unitPriceCents);
   return {id:id(),kind:'OUTRO',partId:null,serviceId:null,description,quantity,price,
     total:Math.round(price*quantity)};
 }
 async function createSale(input={}){
   if(input.workOrderId!=null)fail('Recebimentos da OS devem ser registrados no financeiro da OS');
   if(!Array.isArray(input.items)||!input.items.length||input.items.length>200)fail('Itens da venda inválidos');
   const requestId=clean(input.requestId);if(requestId.length>128)fail('Identificador de venda excede limite');
   const hash=fingerprint({
     customerId:input.customerId??null,paymentMethod:clean(input.paymentMethod)||'DINHEIRO',
     discountCents:cents(input.discountCents??0),items:input.items,
     note:clean(input.note)
   });
   if(requestId){
     const previous=await port.first('SELECT id,request_payload_hash FROM sales WHERE request_id=?',[requestId]);
     if(previous){
       if(previous.request_payload_hash!==hash)fail('Identificador de venda usado com outros dados',409);
       return getSale(previous.id);
     }
   }
   const items=[];for(const item of input.items)items.push(await resolveItem(item));
   const subtotal=items.reduce((sum,x)=>sum+x.total,0),discount=cents(input.discountCents??0);
   if(discount>subtotal)fail('Desconto maior que o subtotal');
   if(input.expectedTotalCents!==undefined&&cents(input.expectedTotalCents)!==subtotal-discount)fail('Total da prévia alterado. Revise os valores antes de concluir.',409);
   const customerId=input.customerId==null?null:key(input.customerId);
   if(customerId&&!await port.first('SELECT id FROM customers WHERE id=?',[customerId]))
     fail('Cliente não encontrado',404);
   const cash=input.cashSessionId
     ?await port.first("SELECT * FROM cash_sessions WHERE id=? AND status='ABERTO'",[key(input.cashSessionId)])
     :await openSession();
   if(!cash)fail('Abra o caixa antes de concluir uma venda',409);
   const byPart=new Map();
   for(const item of items)if(item.partId)
     byPart.set(item.partId,(byPart.get(item.partId)||0)+item.quantity);
   for(const [partId,count] of byPart){
     const part=await port.first('SELECT quantity FROM parts WHERE id=?',[partId]);
     if(!part||Number(part.quantity)+1e-9<count)fail('Estoque insuficiente para os itens da venda',409);
   }
   const saleId=id(),at=time(),method=clean(input.paymentMethod)||'DINHEIRO',total=subtotal-discount;
   const numberSql=port.engine==='postgres'?"nextval('async_sale_number_seq')":'(SELECT COALESCE(MAX(sale_number),0)+1 FROM sales)';
   const insert=command(`INSERT INTO sales(
     id,sale_number,customer_id,cash_session_id,subtotal_cents,discount_cents,
     total_cents,payment_method,status,note,created_by,created_at,request_id,request_payload_hash
   ) SELECT ?,${numberSql},?,?,?,?,?,?,'CONCLUIDA',?,?,?,?,?
     WHERE EXISTS(SELECT 1 FROM cash_sessions WHERE id=? AND status='ABERTO')`,[
     saleId,customerId,cash.id,subtotal,discount,total,method,
     clean(input.note),null,at,requestId||null,requestId?hash:null,cash.id
   ]);
   const changes=[];
   for(const item of items){
     changes.push(command(`INSERT INTO sale_items(
       id,sale_id,kind,part_id,service_id,description,quantity,unit_price_cents,total_cents
     ) VALUES(?,?,?,?,?,?,?,?,?)`,[
       item.id,saleId,item.kind,item.partId,item.serviceId,item.description,
       item.quantity,item.price,item.total
     ]));
     if(item.partId){
       changes.push(command(`UPDATE parts SET
         quantity=CASE WHEN quantity>=? THEN quantity-? ELSE NULL END,updated_at=?
         WHERE id=?`,[item.quantity,item.quantity,at,item.partId]));
       const movementId=id();
       const ref=isD1?'CASE WHEN changes()=1 THEN ? ELSE -1 END':'?';
       changes.push(command(`INSERT INTO inventory_movements(
         id,part_id,type,quantity_delta,work_order_id,note,created_at,source_type,source_item_id
       ) VALUES(?,${ref},'SAIDA_MANUAL',?,NULL,?,?,'SALE_ITEM',?)`,[
         movementId,item.partId,-item.quantity,'Venda '+saleId,at,item.id
       ]));
     }
   }
   if(total>0){
     changes.push(command(`INSERT INTO payment_events(
       id,source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at
     ) VALUES(?,'SALE',?,'PAID',?,?,?,?)`,[id(),saleId,total,method,cash.id,at]));
     changes.push(command(`INSERT INTO cash_movements(
       id,cash_session_id,sale_id,type,amount_cents,payment_method,note,created_at
     ) VALUES(?,?,?,'VENDA',?,?,?,?)`,[id(),cash.id,saleId,total,method,'Venda '+saleId,at]));
   }
   try{
     if(isD1){
       const output=await port.batch([insert,...changes]);
       if(affected(output[0])!==1)fail('Caixa não está aberto',409);
     }else await port.transaction(async tx=>{
       const active=await tx.first("SELECT id FROM cash_sessions WHERE id=? AND status='ABERTO'"+lock,[cash.id]);
       if(!active)fail('Abra o caixa antes de concluir a venda',409);
       const result=await tx.run(insert.sql,insert.params);
       if(affected(result)!==1)fail('Caixa não está aberto',409);
       for(const command of changes){
         const applied=await tx.run(command.sql,command.params);
         if(command.sql.trim().startsWith('UPDATE parts')&&affected(applied)!==1)
           fail('Estoque insuficiente',409);
       }
     });
   }catch(error){
     if(requestId){
       const prior=await port.first('SELECT id,request_payload_hash FROM sales WHERE request_id=?',[requestId]);
       if(prior?.request_payload_hash===hash)return getSale(prior.id);
     }
     throw error;
   }
   return getSale(saleId);
 }
 async function cancelSale({saleId,reason='',userId=null}={}){
   const idSale=key(saleId),why=clean(reason);
   if(why.length<3||why.length>500)fail('Motivo do cancelamento inválido');
   const sale=await getSale(idSale);
   if(sale.status==='CANCELADA')fail('Venda já cancelada',409);
   const cash=await openSession();
   if(Number(sale.total_cents)>0&&!cash)fail('Abra o caixa para registrar o estorno da venda',409);
   const at=time();
   const changes=[
     command(`UPDATE sales SET
       status='CANCELADA',canceled_at=?,cancel_reason=?
       WHERE id=? AND status='CONCLUIDA'`,[at,why,idSale])
   ];
   for(const item of sale.items){
     if(!item.part_id)continue;
     if(!await port.first(`SELECT id FROM inventory_movements
       WHERE source_type='SALE_ITEM' AND source_item_id=?`,[item.id]))continue;
     changes.push(command(`UPDATE parts SET quantity=quantity+?,updated_at=? WHERE id=?`,[
       item.quantity,at,item.part_id
     ]));
     changes.push(command(`INSERT INTO inventory_movements(
       id,part_id,type,quantity_delta,work_order_id,note,created_at,source_type,source_item_id
     ) VALUES(?,?,'ESTORNO',?,NULL,?,?,'SALE_RETURN',?)`,[
       id(),item.part_id,item.quantity,'Estorno venda '+idSale,at,item.id
     ]));
   }
   if(cash&&Number(sale.total_cents)>0){
     changes.push(command(`INSERT INTO payment_events(
       id,source_type,source_id,event_type,amount_cents,method,cash_session_id,created_at
     ) VALUES(?,'SALE',?,'REFUNDED',?,?,?,?)`,[
       id(),idSale,-Number(sale.total_cents),sale.payment_method,cash.id,at
     ]));
     changes.push(command(`INSERT INTO cash_movements(
       id,cash_session_id,sale_id,type,amount_cents,payment_method,note,created_at
     ) VALUES(?,?,?,'ESTORNO',?,?,?,?)`,[
       id(),cash.id,idSale,-Number(sale.total_cents),sale.payment_method,'Estorno venda '+idSale,at
     ]));
   }
   if(isD1){
     const output=await port.batch(changes);
     if(affected(output[0])!==1)fail('Venda já cancelada',409);
   }else await port.transaction(async tx=>{
     const update=await tx.run(changes[0].sql,changes[0].params);
     if(affected(update)!==1)fail('Venda já cancelada',409);
     for(const cmd of changes.slice(1))await tx.run(cmd.sql,cmd.params);
   });
   return getSale(idSale);
 }
 return Object.freeze({
   createService,listServices,openCashSession,closeCashSession,cashSummary,
   createSale,getSale,listSales,cancelSale
 });
}
