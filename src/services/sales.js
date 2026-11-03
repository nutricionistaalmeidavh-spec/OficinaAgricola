import { createHash } from 'node:crypto';
import { nowIso, transaction } from '../db.js';
import { postStockMovement } from './inventory.js';
import { postCashMovement, postPaymentEvent } from './payment-ledger.js';
import {runIdempotent} from '../platform/idempotency.js';

const text = (value) => value == null ? '' : String(value).trim();
const positiveNumber = (value, label = 'Quantidade') => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} inválida`);
  return n;
};
const cents = (value, label = 'Valor') => {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} inválido`);
  return n;
};
const idOrNull = (value) => value == null || value === '' ? null : Number(value);

export function listServices(db, { includeInactive = false, search = '' } = {}) {
  const q = `%${text(search)}%`;
  return db.prepare(`SELECT * FROM service_catalog
    WHERE (?=1 OR active=1) AND (code LIKE ? OR name LIKE ? OR description LIKE ?)
    ORDER BY name`).all(includeInactive ? 1 : 0, q, q, q);
}

export function createService(db, input) {
  const code = text(input.code), name = text(input.name);
  if (!code || !name) throw new Error('Código e nome do serviço são obrigatórios');
  const t = nowIso();
  const result = db.prepare(`INSERT INTO service_catalog(code,name,description,price_cents,estimated_minutes,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(code, name, text(input.description), cents(input.priceCents, 'Preço'), Math.max(0, Number(input.estimatedMinutes || 0)), input.active === false ? 0 : 1, t, t);
  return db.prepare('SELECT * FROM service_catalog WHERE id=?').get(Number(result.lastInsertRowid));
}

export function updateService(db, id, input) {
  const current = db.prepare('SELECT * FROM service_catalog WHERE id=?').get(id);
  if (!current) throw new Error('Serviço não encontrado');
  const next = {
    code: input.code === undefined ? current.code : text(input.code),
    name: input.name === undefined ? current.name : text(input.name),
    description: input.description === undefined ? current.description : text(input.description),
    price: input.priceCents === undefined ? current.price_cents : cents(input.priceCents, 'Preço'),
    minutes: input.estimatedMinutes === undefined ? current.estimated_minutes : Math.max(0, Number(input.estimatedMinutes || 0)),
    active: input.active === undefined ? current.active : (input.active ? 1 : 0),
  };
  if (!next.code || !next.name) throw new Error('Código e nome do serviço são obrigatórios');
  db.prepare(`UPDATE service_catalog SET code=?,name=?,description=?,price_cents=?,estimated_minutes=?,active=?,updated_at=? WHERE id=?`)
    .run(next.code, next.name, next.description, next.price, next.minutes, next.active, nowIso(), id);
  return db.prepare('SELECT * FROM service_catalog WHERE id=?').get(id);
}

export function getOpenCashSession(db) {
  return db.prepare(`SELECT cs.*,u.name opened_by_name
    FROM cash_sessions cs LEFT JOIN users u ON u.id=cs.opened_by
    WHERE cs.status='ABERTO' ORDER BY cs.id DESC LIMIT 1`).get() || null;
}

export function listCashSessions(db, { limit = 30 } = {}) {
  return db.prepare(`SELECT cs.*,u.name opened_by_name
    FROM cash_sessions cs LEFT JOIN users u ON u.id=cs.opened_by
    ORDER BY cs.id DESC LIMIT ?`).all(Math.max(1, Math.min(200, Number(limit) || 30)));
}

export function openCashSession(db,{openingCents=0,note='',userId=null,requestId=null}={}){
  return runIdempotent(db,'cash:open',requestId,{openingCents,note,userId},()=>{
    if(getOpenCashSession(db))throw new Error('Já existe um caixa aberto');
    const opening=cents(openingCents,'Saldo inicial');
    const result=db.prepare(`INSERT INTO cash_sessions(opened_at,opening_cents,opened_by,status,notes)
      VALUES(?,?,?,'ABERTO',?)`).run(nowIso(),opening,userId,text(note));
    return getOpenCashSession(db)||db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(Number(result.lastInsertRowid));
  });
}

function requireOpenCash(db) {
  const session = getOpenCashSession(db);
  if (!session) throw new Error('Abra o caixa antes de registrar esta operação');
  return session;
}

export function addCashMovement(db,{type,amountCents,note='',userId=null,requestId=null}={}){
  return runIdempotent(db,'cash:manual',requestId,{type,amountCents,note,userId},()=>{
    const allowed=new Set(['SUPRIMENTO','SANGRIA','AJUSTE']);
    if(!allowed.has(type))throw new Error('Tipo de movimentação de caixa inválido');
    const session=requireOpenCash(db);
    const value=cents(amountCents);
    if(value<=0)throw new Error('Valor deve ser maior que zero');
    const signed=type==='SANGRIA'?-value:value;
    return db.prepare('SELECT * FROM cash_movements WHERE id=?').get(
      postCashMovement(db,{cashSessionId:session.id,type,amountCents:signed,
        paymentMethod:'DINHEIRO',note,createdBy:userId})
    );
  });
}

function normalizeSaleItem(db, input) {
  const quantity = positiveNumber(input.quantity);
  const partId = idOrNull(input.partId);
  const serviceId = idOrNull(input.serviceId);
  if (partId) {
    const part = db.prepare('SELECT * FROM parts WHERE id=? AND active=1').get(partId);
    if (!part) throw new Error('Peça da venda não encontrada');
    if (Number(part.quantity) < quantity) throw new Error(`Estoque insuficiente para ${part.description}`);
    const unit = input.unitPriceCents === undefined ? part.sale_price_cents : cents(input.unitPriceCents, 'Preço unitário');
    return { kind: 'PECA', partId, serviceId: null, description: text(input.description) || part.description, quantity, unitPriceCents: unit, totalCents: Math.round(quantity * unit), part };
  }
  if (serviceId) {
    const service = db.prepare('SELECT * FROM service_catalog WHERE id=? AND active=1').get(serviceId);
    if (!service) throw new Error('Serviço da venda não encontrado');
    const unit = input.unitPriceCents === undefined ? service.price_cents : cents(input.unitPriceCents, 'Preço unitário');
    return { kind: 'SERVICO', partId: null, serviceId, description: text(input.description) || service.name, quantity, unitPriceCents: unit, totalCents: Math.round(quantity * unit) };
  }
  const description = text(input.description);
  if (!description) throw new Error('Descrição do item é obrigatória');
  const unit = cents(input.unitPriceCents, 'Preço unitário');
  return { kind: 'OUTRO', partId: null, serviceId: null, description, quantity, unitPriceCents: unit, totalCents: Math.round(quantity * unit) };
}

function saleFingerprint(input,items) {
  return createHash('sha256').update(JSON.stringify({
    customerId:idOrNull(input.customerId),
    paymentMethod:text(input.paymentMethod)||'DINHEIRO',
    discountCents:cents(input.discountCents??0,'Desconto'),
    note:text(input.note),
    items:items.map(i=>({
      partId:idOrNull(i.partId),serviceId:idOrNull(i.serviceId),
      quantity:Number(i.quantity),unitPriceCents:i.unitPriceCents==null?null:cents(i.unitPriceCents,'Preço unitário'),
      description:text(i.description),
    })),
  })).digest('hex');
}

export function createSale(db, input, { userId = null } = {}) {
  if(input.workOrderId!=null)throw new Error('Recebimentos de OS devem ser registrados no financeiro da ordem de serviço; venda balcão separada');
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) throw new Error('A venda precisa ter ao menos um item');
  const requestId=text(input.requestId);
  if(requestId.length>128)throw new Error('Identificador da venda excede o limite');
  const fingerprint=requestId?saleFingerprint(input,rawItems):null;
  return transaction(db, () => {
    if(requestId){
      const previous=db.prepare('SELECT id,request_payload_hash FROM sales WHERE request_id=?').get(requestId);
      if(previous){
        if(previous.request_payload_hash!==fingerprint)throw new Error('Identificador de venda já utilizado com dados diferentes');
        return getSale(db,previous.id);
      }
    }
    const cash = input.cashSessionId
      ? db.prepare("SELECT * FROM cash_sessions WHERE id=? AND status='ABERTO'").get(Number(input.cashSessionId))
      : getOpenCashSession(db);
    if (!cash) throw new Error('Abra o caixa antes de concluir uma venda');
    const items = rawItems.map(item => normalizeSaleItem(db, item));
    const requiredByPart=new Map();
    for(const item of items)if(item.partId)requiredByPart.set(item.partId,(requiredByPart.get(item.partId)||0)+item.quantity);
    for(const [partId,quantity] of requiredByPart){
      const stock=Number(db.prepare('SELECT quantity FROM parts WHERE id=?').get(partId)?.quantity||0);
      if(stock+1e-9<quantity)throw new Error('Estoque insuficiente para os itens da venda');
    }
    const subtotal = items.reduce((sum, item) => sum + item.totalCents, 0);
    const discount = cents(input.discountCents, 'Desconto');
    if (discount > subtotal) throw new Error('Desconto não pode ser maior que o subtotal');
    const total = subtotal - discount;
    const customerId = idOrNull(input.customerId);
    if (customerId && !db.prepare('SELECT 1 FROM customers WHERE id=?').get(customerId)) throw new Error('Cliente não encontrado');
    const paymentMethod = text(input.paymentMethod) || 'DINHEIRO';
    const saleNumber = Number(db.prepare('SELECT COALESCE(MAX(sale_number),0)+1 n FROM sales').get().n);
    const createdAt = nowIso();
    const saleResult = db.prepare(`INSERT INTO sales(sale_number,customer_id,cash_session_id,subtotal_cents,discount_cents,total_cents,payment_method,status,note,created_by,created_at,request_id,request_payload_hash)
      VALUES(?,?,?,?,?,?,?,'CONCLUIDA',?,?,?,?,?)`).run(saleNumber, customerId, cash.id, subtotal, discount, total, paymentMethod, text(input.note), userId, createdAt, requestId||null, fingerprint);
    const saleId = Number(saleResult.lastInsertRowid);

    for (const item of items) {
      const itemResult = db.prepare(`INSERT INTO sale_items(sale_id,kind,part_id,service_id,description,quantity,unit_price_cents,total_cents)
        VALUES(?,?,?,?,?,?,?,?)`).run(saleId, item.kind, item.partId, item.serviceId, item.description, item.quantity, item.unitPriceCents, item.totalCents);
      if (item.partId) {
        postStockMovement(db,item.partId,{
          type:'SAIDA_MANUAL',quantity:item.quantity,originType:'SALE_ITEM',
          originItemId:Number(itemResult.lastInsertRowid),
          note:`Venda #${saleNumber}`,createdBy:userId
        });
      }
    }

    if(total>0)postPaymentEvent(db,{
      sourceType:'SALE',sourceId:saleId,eventType:'PAID',
      amountCents:total,method:paymentMethod,cashSessionId:cash.id,
      createdBy:userId,note:`Venda #${saleNumber}`,createdAt
    });
    return getSale(db, saleId);
  });
}

export function getSale(db, id) {
  const sale = db.prepare(`SELECT s.*,c.name customer_name,u.name created_by_name
    FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.created_by WHERE s.id=?`).get(id);
  if (!sale) throw new Error('Venda não encontrada');
  sale.items = db.prepare(`SELECT si.*,p.sku,sc.code service_code FROM sale_items si
    LEFT JOIN parts p ON p.id=si.part_id LEFT JOIN service_catalog sc ON sc.id=si.service_id
    WHERE si.sale_id=? ORDER BY si.id`).all(id);
  return sale;
}

export function listSales(db, { limit = 100 } = {}) {
  return db.prepare(`SELECT s.*,c.name customer_name,u.name created_by_name
    FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.created_by
    ORDER BY s.id DESC LIMIT ?`).all(Math.max(1, Math.min(500, Number(limit) || 100)));
}

export function cancelSale(db, id, { reason = '', userId = null } = {}) {
  const cancelReason = text(reason);
  if (cancelReason.length < 3) throw new Error('Motivo do cancelamento obrigatório (mínimo 3 caracteres)');
  if (cancelReason.length > 500) throw new Error('Motivo do cancelamento excede 500 caracteres');
  return transaction(db, () => {
    const sale = getSale(db, id);
    if (sale.status === 'CANCELADA') throw new Error('Venda já cancelada');
    const currentCash=getOpenCashSession(db);
    if(sale.total_cents>0&&!currentCash)throw new Error('Abra o caixa para registrar o estorno da venda');
    const t = nowIso();
    const stock=db.prepare(`SELECT im.* FROM inventory_movements im
      JOIN sale_items si ON si.id=im.source_item_id
      WHERE im.source_type='SALE_ITEM' AND si.sale_id=?
        AND NOT EXISTS (
          SELECT 1 FROM inventory_movements reversal
          WHERE reversal.source_type='SALE_RETURN' AND reversal.source_item_id=im.source_item_id
        )`).all(id);
    for(const movement of stock){
      postStockMovement(db,movement.part_id,{
        type:'ESTORNO',quantity:-Number(movement.quantity_delta),
        originType:'SALE_RETURN',originItemId:Number(movement.source_item_id),
        note:`Estorno venda #${sale.sale_number}`,createdBy:userId,
      });
    }
    db.prepare(`UPDATE sales SET status='CANCELADA',canceled_at=?,cancel_reason=? WHERE id=?`).run(t, cancelReason, id);
    if(currentCash&&sale.total_cents>0)postPaymentEvent(db,{
      sourceType:'SALE',sourceId:id,eventType:'REFUNDED',
      amountCents:sale.total_cents,method:sale.payment_method,
      cashSessionId:currentCash.id,createdBy:userId,
      note:`Estorno venda #${sale.sale_number}`,createdAt:t
    });
    return getSale(db, id);
  });
}

export function cashSummary(db) {
  const session = getOpenCashSession(db);
  if (!session) return { session: null, movements: [], expectedCashCents: 0, movementTotalCents: 0, byMethod: [] };
  const movements = db.prepare('SELECT * FROM cash_movements WHERE cash_session_id=? ORDER BY id DESC').all(session.id);
  const expectedCashCents = session.opening_cents + movements.filter(m => m.payment_method === 'DINHEIRO').reduce((sum, m) => sum + Number(m.amount_cents), 0);
  const movementTotalCents = movements.reduce((sum, m) => sum + Number(m.amount_cents), 0);
  const byMethod = db.prepare(`SELECT payment_method,SUM(amount_cents) total_cents FROM cash_movements
    WHERE cash_session_id=? GROUP BY payment_method ORDER BY payment_method`).all(session.id);
  return { session, movements, expectedCashCents, movementTotalCents, byMethod };
}

export function closeCashSession(db,{closingCents,note='',requestId=null}={}){
  return runIdempotent(db,'cash:close',requestId,{closingCents,note},()=>{
    const session=requireOpenCash(db);
    const closing=cents(closingCents,'Saldo contado');
    const summary=cashSummary(db);
    const difference=closing-summary.expectedCashCents;
    db.prepare(`UPDATE cash_sessions SET status='FECHADO',closed_at=?,closing_cents=?,expected_cents=?,difference_cents=?,notes=? WHERE id=?`)
      .run(nowIso(),closing,summary.expectedCashCents,difference,text(note)||session.notes,session.id);
    return db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(session.id);
  });
}
