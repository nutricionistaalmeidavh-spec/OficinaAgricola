import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { openCashSession } from '../src/services/sales.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder } from '../src/services/work-orders.js';
import { saveQuote, approveQuote } from '../src/services/quotes.js';
import { addReceipt, reverseReceipt, getPaymentSummary, createExpense, financeSummary } from '../src/services/finance.js';

function setup(){
 const db=openDatabase(':memory:'); migrate(db); migrateAssistencia(db); openCashSession(db,{openingCents:0}); const c=createCustomer(db,{name:'Fazenda'}); const m=createMachine(db,{customerId:c.id,type:'Trator'});
 const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Falha'}); transitionWorkOrder(db,os.id,'DIAGNOSTICO'); saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:10000}]}); approveQuote(db,os.id);
 return {db,os};
}

test('tracks partial and full payments for work order',()=>{
 const {db,os}=setup(); addReceipt(db,os.id,{amountCents:4000,method:'PIX',receivedAt:'2030-01-05T12:00:00.000Z'}); assert.deepEqual(getPaymentSummary(db,os.id),{totalCents:10000,receivedCents:4000,pendingCents:6000,status:'PARCIAL'});
 addReceipt(db,os.id,{amountCents:6000,method:'DINHEIRO',receivedAt:'2030-01-06T12:00:00.000Z'}); assert.deepEqual(getPaymentSummary(db,os.id),{totalCents:10000,receivedCents:10000,pendingCents:0,status:'PAGO'}); db.close();
});

test('reverses receipt without deleting audit history',()=>{
 const {db,os}=setup(); const r=addReceipt(db,os.id,{amountCents:10000,method:'PIX'}); reverseReceipt(db,os.id,r.id,{note:'Pagamento cancelado'});
 assert.equal(getPaymentSummary(db,os.id).status,'PENDENTE'); assert.equal(db.prepare('SELECT COUNT(*) n FROM receipts WHERE work_order_id=?').get(os.id).n,1); assert.ok(db.prepare('SELECT reversed_at FROM receipts WHERE id=?').get(r.id).reversed_at); db.close();
});

test('rejects receipt above pending balance',()=>{
 const {db,os}=setup(); assert.throws(()=>addReceipt(db,os.id,{amountCents:11000,method:'PIX'}),/saldo pendente/); db.close();
});

test('financial summary separates invoiced received pending expenses and result',()=>{
 const {db,os}=setup(); addReceipt(db,os.id,{amountCents:4000,method:'PIX',receivedAt:'2030-01-10T12:00:00.000Z'}); createExpense(db,{description:'Óleo',category:'Insumos',amountCents:1500,dueDate:'2030-01-09',paidAt:'2030-01-09T10:00:00.000Z',workOrderId:os.id});
 const s=financeSummary(db,{from:'2000-01-01T00:00:00.000Z',to:'2100-01-31T23:59:59.999Z'}); assert.equal(s.invoicedCents,10000); assert.equal(s.receivedCents,4000); assert.equal(s.pendingCents,6000); assert.equal(s.expensesCents,1500); assert.equal(s.resultCents,2500); db.close();
});
