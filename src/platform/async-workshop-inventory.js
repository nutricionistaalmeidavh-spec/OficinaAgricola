import {randomBytes,createHash} from 'node:crypto';
import {normalizeGtin} from './inventory-gtin.js';

// The materialized part quantity is always modified together with the
// inventory_movements canonical ledger, on one DB connection/atomic D1 batch.
const nextId=()=>randomBytes(6).readUIntBE(0,6);
const clean=value=>String(value??'').trim();
const positive=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n;};
const nonnegative=(value,label='Valor')=>{const n=Number(value??0);if(!Number.isSafeInteger(n)||n<0)throw Error(label+' inválido');return n;};
const qty=value=>{const n=Number(value);if(!Number.isFinite(n)||n<=0||n>1000000)throw Error('Quantidade inválida');return n;};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const at=()=>new Date().toISOString();
const stmt=(sql,params=[])=>({sql,params});
const affected=result=>Number(result?.changes??result?.meta?.changes??0);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const restrict=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||min));
export function createAsyncWorkshopInventory(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function atomic(queries){
   if(port.engine==='d1')return port.batch(queries);
   return port.transaction(async tx=>{
     const out=[];for(const q of queries)out.push(await tx.run(q.sql,q.params));return out;
   });
 }
 async function getPart(partId){
   const row=await port.first('SELECT * FROM parts WHERE id=?',[positive(partId)]);
   if(!row)fail('Peça não encontrada',404);
   return row;
 }
 async function listParts({includeInactive=false,search=''}={}){
   const like='%'+clean(search)+'%';
   return port.all(`SELECT * FROM parts WHERE (?=1 OR active=1)
     AND (sku LIKE ? OR description LIKE ? OR category LIKE ? OR barcode LIKE ?)
     ORDER BY description,id`,[includeInactive?1:0,like,like,like,like]);
 }
 async function listPartsPage({includeInactive=false,search='',limit=50,cursor=null}={}){
   const filter=['(?=1 OR active=1)'],params=[includeInactive?1:0];
   if(clean(search)){const like='%'+clean(search)+'%';
     filter.push('(sku LIKE ? OR description LIKE ? OR category LIKE ? OR barcode LIKE ?)');
     params.push(like,like,like,like);
   }
   const where=' WHERE '+filter.join(' AND '),size=restrict(limit,1,100);
   const total=Number((await port.first('SELECT COUNT(*) n FROM parts'+where,params)).n);
   const next=cursor==null||cursor===''?null:positive(cursor);
   const rows=await port.all(`SELECT * FROM parts${where}
     ${next==null?'':' AND id>?'} ORDER BY id ASC LIMIT ?`,
     [...params,...(next==null?[]:[next]),size+1]);
   const more=rows.length>size,items=more?rows.slice(0,size):rows;
   return {items,total,nextCursor:more?items.at(-1)?.id??null:null};
 }
 async function updatePart(partId,input={}){
   const old=await getPart(partId);
   const pick=(name,field)=>input[name]===undefined?old[field]:clean(input[name]);
   const sku=pick('sku','sku'),description=pick('description','description');
   if(!sku||!description)fail('SKU e descrição são obrigatórios');
   const minStock=input.minStock===undefined?Number(old.min_stock):Number(input.minStock);
   if(!Number.isFinite(minStock)||minStock<0)fail('Estoque mínimo inválido');
   await port.run(`UPDATE parts SET sku=?,description=?,category=?,unit=?,
     cost_cents=?,sale_price_cents=?,min_stock=?,location=?,barcode=?,active=?,updated_at=? WHERE id=?`,[
     sku,description,pick('category','category'),pick('unit','unit'),
     input.costCents===undefined?old.cost_cents:nonnegative(input.costCents,'Custo'),
     input.salePriceCents===undefined?old.sale_price_cents:nonnegative(input.salePriceCents,'Preço'),
     minStock,pick('location','location'),
     input.barcode===undefined?old.barcode:normalizeGtin(input.barcode),
     input.active===undefined?old.active:input.active?1:0,at(),old.id
   ]);
   return getPart(old.id);
 }
 async function lowStockParts(){
   return port.all(`SELECT * FROM parts WHERE active=1 AND quantity<=min_stock
     ORDER BY quantity-min_stock,description,id`);
 }
 async function reconcileStock(partId){
   const part=await getPart(partId);
   const row=await port.first(`SELECT COALESCE(SUM(quantity_delta),0) total
     FROM inventory_movements WHERE part_id=?`,[part.id]);
   const ledgerQuantity=Number(row.total),quantity=Number(part.quantity);
   return {partId:part.id,quantity,ledgerQuantity,difference:Number((quantity-ledgerQuantity).toFixed(8))};
 }
 async function listWorkOrderParts(workOrderId){
   return port.all(`SELECT wop.*,p.sku,p.description FROM work_order_parts wop
     JOIN parts p ON p.id=wop.part_id WHERE wop.work_order_id=? ORDER BY wop.id`,
     [positive(workOrderId)]);
 }
 async function idempotentRecord(scope,requestId,payload){
   const request=clean(requestId),hash=sha(payload);
   if(!request)return {request:null,hash,previous:null};
   if(request.length>128)fail('Identificador idempotente excede o limite');
   const row=await port.first(`SELECT payload_hash,result_json FROM command_idempotency
     WHERE scope=? AND request_id=?`,[scope,request]);
   if(row){
     if(row.payload_hash!==hash)fail('Identificador já usado com conteúdo diferente',409);
     return {request,hash,previous:JSON.parse(row.result_json)};
   }
   return {request,hash,previous:null};
 }
 async function consumePart(input={}){
   const workOrderId=positive(input.workOrderId),partId=positive(input.partId),
     quantity=qty(input.quantity),note=clean(input.note);
   const unitPriceCents=input.unitPriceCents==null?null:nonnegative(input.unitPriceCents,'Preço');
   const scope='work-order:'+workOrderId+':part';
   const command={workOrderId,partId,quantity,note,unitPriceCents};
   const request=await idempotentRecord(scope,input.requestId,command);
   if(request.previous)return port.first('SELECT * FROM work_order_parts WHERE id=?',[request.previous.id]);
   const os=await port.first('SELECT status FROM work_orders WHERE id=?',[workOrderId]);
   if(!os)fail('OS não encontrada',404);
   if(!['APROVADA','EM_SERVICO'].includes(os.status))
     fail('OS precisa estar aprovada ou em serviço',409);
   const part=await getPart(partId);
   const price=unitPriceCents??Number(part.sale_price_cents),itemId=nextId(),movementId=nextId(),stamp=at();
   const stock=stmt(`UPDATE parts SET quantity=quantity-?,updated_at=?
     WHERE id=? AND active=1 AND quantity>=?
       AND EXISTS(SELECT 1 FROM work_orders WHERE id=?
         AND status IN ('APROVADA','EM_SERVICO'))`,[
     quantity,stamp,partId,quantity-0.00000001,workOrderId
   ]);
   const movement=stmt(`INSERT INTO inventory_movements(
     id,part_id,type,quantity_delta,work_order_id,note,created_at,source_type,source_item_id
   ) ${port.engine==='d1'?"SELECT ?,?,'CONSUMO_OS',?,?,?,?,?,? WHERE changes()=1":"VALUES(?,?,'CONSUMO_OS',?,?,?,?,?,?)"}`,[
     movementId,partId,-quantity,workOrderId,note,stamp,'OS_PART',itemId
   ]);
   const consume=stmt(`INSERT INTO work_order_parts(
     id,work_order_id,part_id,quantity,unit_price_cents,movement_id
   ) ${port.engine==='d1'?'SELECT ?,?,?,?,?,? WHERE changes()=1':'VALUES(?,?,?,?,?,?)'}`,[
     itemId,workOrderId,partId,quantity,price,movementId
   ]);
   const queries=[stock,movement,consume];
   if(request.request)queries.push(stmt(`INSERT INTO command_idempotency(
     scope,request_id,payload_hash,result_json,created_at
   ) ${port.engine==='d1'?'SELECT ?,?,?,?,? WHERE changes()=1':'VALUES(?,?,?,?,?)'}`,[
     scope,request.request,request.hash,JSON.stringify({id:itemId}),stamp
   ]));
   try{
     if(port.engine==='d1'){
       const result=await port.batch(queries);
       if(affected(result[0])!==1)fail('Estoque insuficiente',409);
     }else await port.transaction(async tx=>{
       const status=await tx.first('SELECT status FROM work_orders WHERE id=?'+
         (port.engine==='postgres'?' FOR UPDATE':''),[workOrderId]);
       if(!status||!['APROVADA','EM_SERVICO'].includes(status.status))
         fail('OS não está aprovada',409);
       const result=await tx.run(stock.sql,stock.params);
       if(affected(result)!==1)fail('Estoque insuficiente',409);
       for(const entry of queries.slice(1))await tx.run(entry.sql,entry.params);
     });
   }catch(error){
     const replay=await idempotentRecord(scope,input.requestId,command);
     if(replay.previous)
       return port.first('SELECT * FROM work_order_parts WHERE id=?',[replay.previous.id]);
     throw error;
   }
   return port.first('SELECT * FROM work_order_parts WHERE id=?',[itemId]);
 }
 async function reverseWorkOrderPart({workOrderId,itemId,note=''}={}){
   const item=await port.first('SELECT * FROM work_order_parts WHERE id=?',[positive(itemId)]);
   if(!item)fail('Consumo não encontrado',404);
   if(workOrderId!=null&&Number(item.work_order_id)!==positive(workOrderId))
     fail('Consumo não pertence à OS informada',409);
   if(item.reversed_at)fail('Consumo já estornado',409);
   const stamp=at(),returned=nextId();
   const update=stmt(`UPDATE work_order_parts SET reversed_at=?
     WHERE id=? AND reversed_at IS NULL`,[stamp,item.id]);
   const restore=stmt(`UPDATE parts SET quantity=quantity+?,updated_at=?
     WHERE id=? AND EXISTS(SELECT 1 FROM work_order_parts
       WHERE id=? AND reversed_at=?)`,[
     item.quantity,stamp,item.part_id,item.id,stamp
   ]);
   const event=stmt(`INSERT INTO inventory_movements(
     id,part_id,type,quantity_delta,work_order_id,note,created_at,source_type,source_item_id
   ) VALUES(?,?,'ESTORNO',?,?,?,?,?,?)`,[
     returned,item.part_id,item.quantity,item.work_order_id,clean(note),
     stamp,'OS_PART_RETURN',item.id
   ]);
   if(port.engine==='d1'){
     const results=await port.batch([update,restore,event]);
     if(affected(results[0])!==1)fail('Consumo já estornado',409);
   }else await port.transaction(async tx=>{
     const result=await tx.run(update.sql,update.params);
     if(affected(result)!==1)fail('Consumo já estornado',409);
     await tx.run(restore.sql,restore.params);
     await tx.run(event.sql,event.params);
   });
   return port.first('SELECT * FROM work_order_parts WHERE id=?',[item.id]);
 }
 return Object.freeze({getPart,listParts,listPartsPage,updatePart,
   lowStockParts,reconcileStock,listWorkOrderParts,consumePart,reverseWorkOrderPart});
}
