import { nowIso, transaction } from '../db.js';
import { getWorkOrder } from './work-orders.js';

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
function applyMovement(db,partId,{type,quantity,workOrderId=null,note='',createdBy=null,allowNegative=false,userRole=''}){
  if(!TYPES.has(type))throw new Error('Tipo de movimentação inválido');
  const part=getPart(db,partId),delta=movementDelta(type,quantity),next=Number(part.quantity)+delta;
  if(next<0 && !(allowNegative&&userRole==='ADMIN')) throw new Error('Estoque insuficiente');
  const t=nowIso(); const r=db.prepare(`INSERT INTO inventory_movements(part_id,type,quantity_delta,work_order_id,note,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(partId,type,delta,workOrderId,text(note),createdBy,t);
  db.prepare('UPDATE parts SET quantity=?,updated_at=? WHERE id=?').run(next,t,partId);
  return {id:Number(r.lastInsertRowid),partId,type,quantityDelta:delta,newQuantity:next};
}
export function addInventoryMovement(db,partId,input){return transaction(db,()=>applyMovement(db,partId,input))}

export function consumePart(db,workOrderId,partId,input){
  return transaction(db,()=>{
    const os=getWorkOrder(db,workOrderId); if(!['APROVADA','EM_SERVICO'].includes(os.status)) throw new Error('OS precisa estar aprovada ou em serviço');
    const q=Number(input.quantity); if(!Number.isFinite(q)||q<=0) throw new Error('Quantidade inválida'); const part=getPart(db,partId);
    const movement=applyMovement(db,partId,{type:'CONSUMO_OS',quantity:q,workOrderId,note:input.note,createdBy:input.createdBy,allowNegative:input.allowNegative,userRole:input.userRole});
    const r=db.prepare('INSERT INTO work_order_parts(work_order_id,part_id,quantity,unit_price_cents,movement_id) VALUES(?,?,?,?,?)').run(workOrderId,partId,q,input.unitPriceCents??part.sale_price_cents,movement.id);
    return db.prepare('SELECT * FROM work_order_parts WHERE id=?').get(Number(r.lastInsertRowid));
  });
}
export function reverseWorkOrderPart(db,itemId,{note='',createdBy=null}={}){
  return transaction(db,()=>{
    const item=db.prepare('SELECT * FROM work_order_parts WHERE id=?').get(itemId); if(!item)throw new Error('Consumo não encontrado'); if(item.reversed_at)throw new Error('Consumo já estornado');
    applyMovement(db,item.part_id,{type:'ESTORNO',quantity:item.quantity,workOrderId:item.work_order_id,note,createdBy}); const t=nowIso();
    db.prepare('UPDATE work_order_parts SET reversed_at=? WHERE id=?').run(t,itemId); return {...item,reversed_at:t};
  });
}
export function listWorkOrderParts(db,workOrderId){return db.prepare(`SELECT wop.*,p.sku,p.description FROM work_order_parts wop JOIN parts p ON p.id=wop.part_id WHERE wop.work_order_id=? ORDER BY wop.id`).all(workOrderId)}
export function lowStockParts(db){return db.prepare('SELECT * FROM parts WHERE active=1 AND quantity<=min_stock ORDER BY quantity-min_stock,description').all()}
