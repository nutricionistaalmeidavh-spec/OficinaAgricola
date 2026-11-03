import {selectPage} from '../platform/pagination.js';
import { nowIso, transaction } from '../db.js';
import { getWorkOrder } from './work-orders.js';
import {runIdempotent} from '../platform/idempotency.js';

const TYPES=new Set(['ENTRADA','SAIDA_MANUAL','CONSUMO_OS','ESTORNO','AJUSTE']);
const text=(v)=>v==null?'':String(v).trim();
const moneyInt=(v,label)=>{const n=Number(v??0);if(!Number.isInteger(n)||n<0)throw new Error(`${label} inválido`);return n};

export function createPart(db,input){
  const sku=text(input.sku),description=text(input.description); if(!sku||!description) throw new Error('SKU e descrição são obrigatórios');
  const t=nowIso(); const r=db.prepare(`INSERT INTO parts(sku,description,category,unit,cost_cents,sale_price_cents,quantity,min_stock,location,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(sku,description,text(input.category),text(input.unit)||'UN',moneyInt(input.costCents,'Custo'),moneyInt(input.salePriceCents,'Preço'),0,Number(input.minStock??0),text(input.location),input.active===false?0:1,t,t);
  return getPart(db,Number(r.lastInsertRowid));
}
export function getPart(db,id){const r=db.prepare('SELECT * FROM parts WHERE id=?').get(id);if(!r)throw new Error('Peça não encontrada');return r}
export function listParts(db,{includeInactive=false,search=''}={}){const q=`%${text(search)}%`;return db.prepare('SELECT * FROM parts WHERE (?=1 OR active=1) AND (sku LIKE ? OR description LIKE ? OR category LIKE ?) ORDER BY description').all(includeInactive?1:0,q,q,q)}
export function updatePart(db,id,input){
  const old=getPart(db,id); const t=nowIso();
  db.prepare(`UPDATE parts SET sku=?,description=?,category=?,unit=?,cost_cents=?,sale_price_cents=?,min_stock=?,location=?,active=?,updated_at=? WHERE id=?`).run(
    input.sku===undefined?old.sku:text(input.sku),input.description===undefined?old.description:text(input.description),input.category===undefined?old.category:text(input.category),input.unit===undefined?old.unit:text(input.unit),
    input.costCents===undefined?old.cost_cents:moneyInt(input.costCents,'Custo'),input.salePriceCents===undefined?old.sale_price_cents:moneyInt(input.salePriceCents,'Preço'),
    input.minStock===undefined?old.min_stock:Number(input.minStock),input.location===undefined?old.location:text(input.location),input.active===undefined?old.active:(input.active?1:0),t,id);
  return getPart(db,id);
}

function movementDelta(type, quantity){
  const q=Number(quantity); if(!Number.isFinite(q)||q===0) throw new Error('Quantidade inválida');
  if(type==='AJUSTE') return q;
  if(q<0) throw new Error('Quantidade deve ser positiva');
  if(type==='ENTRADA'||type==='ESTORNO') return q;
  if(type==='SAIDA_MANUAL'||type==='CONSUMO_OS') return -q;
  throw new Error('Tipo de movimentação inválido');
}
// Autoridade única do saldo e do livro de estoque. Chamar DENTRO de transaction().
export function postStockMovement(db,partId,{
  type,quantity,workOrderId=null,note='',createdBy=null,allowNegative=false,
  userRole='',originType=null,originItemId=null,
}={}){
  if(!TYPES.has(type))throw new Error('Tipo de movimentação inválido');
  if(originType!=null&&(!String(originType).trim()||!Number.isSafeInteger(Number(originItemId))||Number(originItemId)<=0))
    throw new Error('Origem canônica de estoque inválida');
  const delta=movementDelta(type,quantity);
  const allowBelowZero=allowNegative&&userRole==='ADMIN';
  const now=nowIso();
  const changed=db.prepare(`UPDATE parts SET quantity=quantity+?,updated_at=? WHERE id=? AND (quantity+?>=-0.00000001 OR ?=1)`)
    .run(delta,now,partId,delta,allowBelowZero?1:0);
  if(changed.changes!==1){
    getPart(db,partId);
    throw new Error('Estoque insuficiente');
  }
  const result=db.prepare(`INSERT INTO inventory_movements(
    part_id,type,quantity_delta,work_order_id,note,created_by,created_at,source_type,source_item_id
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(partId,type,delta,workOrderId,text(note),createdBy,now,originType,originItemId);
  const part=getPart(db,partId);
  return {id:Number(result.lastInsertRowid),partId,type,quantityDelta:delta,newQuantity:Number(part.quantity)};
}

// Saldo em parts é projeção do livro de movimentos, e não um segundo livro independente.
export function reconcileStock(db,partId){
  const part=getPart(db,partId);
  const sum=db.prepare('SELECT COALESCE(SUM(quantity_delta),0) total FROM inventory_movements WHERE part_id=?').get(partId);
  const ledgerQuantity=Number(sum.total);
  return {partId,quantity:Number(part.quantity),ledgerQuantity,
    difference:Number((Number(part.quantity)-ledgerQuantity).toFixed(8))};
}

export function addInventoryMovement(db,partId,input){
  const {requestId,...command}=input;
  return runIdempotent(db,`inventory:movement:${partId}`,requestId,{partId,...command},
    ()=>postStockMovement(db,partId,command));
}

export function consumePart(db,workOrderId,partId,input){
  const {requestId,...command}=input;
  return runIdempotent(db,`work-order:${workOrderId}:part`,requestId,
    {workOrderId,partId,...command},()=>{
    const os=getWorkOrder(db,workOrderId); if(!['APROVADA','EM_SERVICO'].includes(os.status)) throw new Error('OS precisa estar aprovada ou em serviço');
    const q=Number(command.quantity); if(!Number.isFinite(q)||q<=0) throw new Error('Quantidade inválida'); const part=getPart(db,partId);
    const movement=postStockMovement(db,partId,{type:'CONSUMO_OS',quantity:q,workOrderId,note:command.note,createdBy:command.createdBy,allowNegative:command.allowNegative,userRole:command.userRole});
    const r=db.prepare('INSERT INTO work_order_parts(work_order_id,part_id,quantity,unit_price_cents,movement_id) VALUES(?,?,?,?,?)').run(workOrderId,partId,q,command.unitPriceCents??part.sale_price_cents,movement.id);
    return db.prepare('SELECT * FROM work_order_parts WHERE id=?').get(Number(r.lastInsertRowid));
  });
}
export function reverseWorkOrderPart(db,itemId,{note='',createdBy=null,workOrderId=null}={}){
  return transaction(db,()=>{
    const item=db.prepare('SELECT * FROM work_order_parts WHERE id=?').get(itemId); if(!item)throw new Error('Consumo não encontrado'); if(workOrderId!==null&&Number(item.work_order_id)!==Number(workOrderId))throw new Error('Consumo não pertence à OS informada'); if(item.reversed_at)throw new Error('Consumo já estornado');
    postStockMovement(db,item.part_id,{type:'ESTORNO',quantity:item.quantity,workOrderId:item.work_order_id,note,createdBy}); const t=nowIso();
    db.prepare('UPDATE work_order_parts SET reversed_at=? WHERE id=?').run(t,itemId); return {...item,reversed_at:t};
  });
}
export function listWorkOrderParts(db,workOrderId){return db.prepare(`SELECT wop.*,p.sku,p.description FROM work_order_parts wop JOIN parts p ON p.id=wop.part_id WHERE wop.work_order_id=? ORDER BY wop.id`).all(workOrderId)}
export function lowStockParts(db){return db.prepare('SELECT * FROM parts WHERE active=1 AND quantity<=min_stock ORDER BY quantity-min_stock,description').all()}

export function listPartsPage(db,{includeInactive=false,search='',limit=50,cursor=null}={}){
  const where=[],args=[];
  if(!includeInactive)where.push('p.active=1');
  if(search){const q='%'+text(search)+'%';where.push('(p.sku LIKE ? OR p.description LIKE ? OR p.category LIKE ?)');args.push(q,q,q);}
  return selectPage(db,{from:'FROM parts p',select:'p.*',where,args,
    sort:'p.description COLLATE NOCASE',id:'p.id',direction:'ASC',cursor,limit,scope:'parts'});
}
