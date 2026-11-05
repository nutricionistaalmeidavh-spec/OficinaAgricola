import {randomBytes,createHash} from 'node:crypto';

// All receipts are persisted with the same inventory_movements used by OS and sales.
const nextId=()=>randomBytes(6).readUIntBE(0,6);
const clean=x=>String(x??'').trim();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const key=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};
const qty=x=>{const n=Number(x);if(!Number.isFinite(n)||n<=0||n>1000000)fail('Quantidade inválida');return n;};
const cents=x=>{const n=Number(x??0);if(!Number.isSafeInteger(n)||n<0)fail('Custo inválido');return n;};
const changes=x=>Number(x?.changes??x?.meta?.changes??0);
const timestamp=()=>new Date().toISOString();
const maxLimit=x=>Math.max(1,Math.min(100,Number(x)||50));
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const normalizedActor=x=>x==null?null:key(x);

export function createAsyncWorkshopProcurement(port){
 if(!['sqlite','postgres'].includes(port?.engine)){
  // D1 has no interactive transactional locking for conditional partial receipts.
  const unavailable=async()=>fail('Compras exigem PostgreSQL ou SQLite local',501);
  return Object.freeze({listStockMovements:unavailable,listSuppliers:unavailable,
   createSupplier:unavailable,createPurchaseOrder:unavailable,
   getPurchaseOrder:unavailable,listPurchaseOrders:unavailable,receivePurchaseOrder:unavailable});
 }
 async function listStockMovements({partId=null,type='',from='',to='',search='',limit=50,cursor=null}={}){
  const where=[],params=[];
  if(partId!=null&&partId!==''){where.push('m.part_id=?');params.push(key(partId));}
  if(clean(type)){where.push('m.type=?');params.push(clean(type).toUpperCase());}
  if(clean(from)){if(!Number.isFinite(Date.parse(from)))fail('Data inicial inválida');where.push('m.created_at>=?');params.push(new Date(from).toISOString());}
  if(clean(to)){if(!Number.isFinite(Date.parse(to)))fail('Data final inválida');where.push('m.created_at<=?');params.push(new Date(to).toISOString());}
  if(clean(search)){
   const q='%'+clean(search).slice(0,100)+'%';
   where.push('(LOWER(p.sku) LIKE LOWER(?) OR LOWER(p.description) LIKE LOWER(?) OR LOWER(m.note) LIKE LOWER(?))');
   params.push(q,q,q);
  }
  if(cursor!=null&&cursor!==''){where.push('m.id<?');params.push(key(cursor));}
  const size=maxLimit(limit);
  const items=await port.all(`SELECT m.*,p.sku,p.description FROM inventory_movements m
   JOIN parts p ON p.id=m.part_id ${where.length?'WHERE '+where.join(' AND '):''}
   ORDER BY m.id DESC LIMIT ?`,[...params,size+1]);
  return {items:items.slice(0,size),nextCursor:items.length>size?items[size-1].id:null};
 }
 async function listSuppliers({search='',limit=100}={}){
  const q='%'+clean(search).slice(0,100)+'%';
  return port.all(`SELECT * FROM suppliers WHERE active=1 AND
   (LOWER(name) LIKE LOWER(?) OR document LIKE ?) ORDER BY name,id LIMIT ?`,
   [q,q,maxLimit(limit)]);
 }
 async function createSupplier(input={}){
  const name=clean(input.name),document=clean(input.document),
   email=clean(input.email),phone=clean(input.phone);
  if(name.length<2||name.length>160)fail('Informe o nome do fornecedor (2 a 160 caracteres)');
  if(document.length>32||phone.length>40||email.length>160)fail('Dados do fornecedor excedem limite');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('E-mail inválido');
  const id=nextId(),at=timestamp();
  await port.run(`INSERT INTO suppliers(id,name,document,phone,email,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?)`,[id,name,document,phone,email,at,at]);
  return port.first('SELECT * FROM suppliers WHERE id=?',[id]);
 }
 async function getPurchaseOrder(orderId){
  const row=await port.first(`SELECT o.*,s.name supplier_name FROM purchase_orders o
   JOIN suppliers s ON s.id=o.supplier_id WHERE o.id=?`,[key(orderId)]);
  if(!row)fail('Pedido de compra não encontrado',404);
  const items=await port.all(`SELECT i.*,p.sku,p.description FROM purchase_order_items i
   JOIN parts p ON p.id=i.part_id WHERE i.order_id=? ORDER BY i.id`,[row.id]);
  return {...row,items};
 }
 async function listPurchaseOrders({status='',limit=50}={}){
  const where=clean(status)?'WHERE o.status=?':'';
  return port.all(`SELECT o.*,s.name supplier_name FROM purchase_orders o
   JOIN suppliers s ON s.id=o.supplier_id ${where} ORDER BY o.id DESC LIMIT ?`,
   [...(where?[clean(status).toUpperCase()]:[]),maxLimit(limit)]);
 }
 async function createPurchaseOrder(input={}){
  const supplierId=key(input.supplierId),reference=clean(input.reference),note=clean(input.note);
  const actorId=normalizedActor(input.actorId);
  if(reference.length>120||note.length>1000)fail('Referência ou observação muito longa');
  const items=input.items;
  if(!Array.isArray(items)||items.length<1||items.length>100)fail('Adicione de 1 a 100 peças no pedido');
  const normalized=items.map(item=>({
   partId:key(item.partId),quantity:qty(item.quantity),costCents:cents(item.costCents)
  }));
  if(new Set(normalized.map(i=>i.partId)).size!==normalized.length)
   fail('Não repita a mesma peça no pedido');
  const orderId=nextId(),at=timestamp();
  await port.transaction(async tx=>{
   if(!await tx.first('SELECT id FROM suppliers WHERE id=? AND active=1',[supplierId]))
    fail('Fornecedor não encontrado',404);
   for(const item of normalized){
    if(!await tx.first('SELECT id FROM parts WHERE id=? AND active=1',[item.partId]))
     fail('Peça indisponível',404);
   }
   await tx.run(`INSERT INTO purchase_orders(
    id,supplier_id,reference,note,status,created_by,created_at,updated_at
   ) VALUES(?,?,?,?,'PEDIDO',?,?,?)`,[orderId,supplierId,reference,note,actorId,at,at]);
   for(const item of normalized)
    await tx.run(`INSERT INTO purchase_order_items(
      id,order_id,part_id,quantity,received_quantity,cost_cents
    ) VALUES(?,?,?,?,0,?)`,[nextId(),orderId,item.partId,item.quantity,item.costCents]);
  });
  return getPurchaseOrder(orderId);
 }
 async function receivePurchaseOrder(input={}){
  const orderId=key(input.orderId),requestId=clean(input.requestId),
   note=clean(input.note),actorId=normalizedActor(input.actorId);
  if(!/^[A-Za-z0-9_:.-]{3,128}$/.test(requestId))fail('Identificador do recebimento obrigatório');
  if(note.length>1000)fail('Observação muito longa');
  if(!Array.isArray(input.items)||input.items.length<1||input.items.length>100)
   fail('Selecione ao menos um item a receber');
  const lines=input.items.map(item=>({itemId:key(item.itemId),quantity:qty(item.quantity)}))
   .sort((a,b)=>a.itemId-b.itemId);
  if(new Set(lines.map(x=>x.itemId)).size!==lines.length)fail('Item repetido no recebimento');
  const hash=fingerprint({orderId,lines,note});
  const fromExisting=async tx=>{
   const existing=await tx.first('SELECT * FROM purchase_receipts WHERE request_id=?',[requestId]);
   if(!existing)return null;
   if(existing.payload_hash!==hash)fail('Identificador do recebimento reutilizado com dados diferentes',409);
   return existing;
  };
  return port.transaction(async tx=>{
   // Serializes simultaneous receipts against this purchase order in PostgreSQL.
   const order=await tx.first('SELECT * FROM purchase_orders WHERE id=?'+
    (port.engine==='postgres'?' FOR UPDATE':''),[orderId]);
   if(!order)fail('Pedido de compra não encontrado',404);
   const repeat=await fromExisting(tx);
   if(repeat)return repeat;
   if(!['PEDIDO','PARCIAL'].includes(order.status))
    fail('Pedido já finalizado ou cancelado',409);
   const storedItems=[];
   for(const line of lines){
    const item=await tx.first('SELECT * FROM purchase_order_items WHERE id=? AND order_id=?',
     [line.itemId,orderId]);
    if(!item)fail('Item não pertence ao pedido',409);
    const remaining=Number(item.quantity)-Number(item.received_quantity);
    if(line.quantity>remaining+1e-9)fail('Quantidade excede saldo pendente do pedido',409);
    storedItems.push({...line,partId:Number(item.part_id)});
   }
   const receiptId=nextId(),at=timestamp();
   await tx.run(`INSERT INTO purchase_receipts(
    id,order_id,request_id,payload_hash,note,created_by,created_at
   ) VALUES(?,?,?,?,?,?,?)`,[receiptId,orderId,requestId,hash,note,actorId,at]);
   for(const item of storedItems){
    const updated=await tx.run(`UPDATE purchase_order_items
     SET received_quantity=received_quantity+? WHERE id=? AND order_id=?
      AND received_quantity+?<=quantity`,[item.quantity,item.itemId,orderId,item.quantity]);
    if(changes(updated)!==1)fail('Quantidade excede saldo pendente do pedido',409);
    const changed=await tx.run(`UPDATE parts SET quantity=quantity+?,updated_at=?
     WHERE id=? AND active=1`,[item.quantity,at,item.partId]);
    if(changes(changed)!==1)fail('Peça de estoque indisponível',409);
    const lineId=nextId(),movementId=nextId();
    await tx.run(`INSERT INTO inventory_movements(
     id,part_id,type,quantity_delta,note,created_by,created_at,source_type,source_item_id
    ) VALUES(?,?,'ENTRADA',?,?,?,?,?,?)`,[
     movementId,item.partId,item.quantity,
     note||'Recebimento do pedido de compra',actorId,at,'PURCHASE_RECEIPT_LINE',lineId
    ]);
    await tx.run(`INSERT INTO purchase_receipt_lines(
      id,receipt_id,order_item_id,quantity,movement_id
    ) VALUES(?,?,?,?,?)`,[lineId,receiptId,item.itemId,item.quantity,movementId]);
   }
   const pending=await tx.first(`SELECT COUNT(*) n FROM purchase_order_items
     WHERE order_id=? AND received_quantity<quantity`,[orderId]);
   await tx.run('UPDATE purchase_orders SET status=?,updated_at=? WHERE id=?',
     [Number(pending.n)===0?'RECEBIDO':'PARCIAL',at,orderId]);
   return {id:receiptId,order_id:orderId,request_id:requestId,created_at:at};
  });
 }
 return Object.freeze({listStockMovements,listSuppliers,createSupplier,
  createPurchaseOrder,getPurchaseOrder,listPurchaseOrders,receivePurchaseOrder});
}
