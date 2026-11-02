import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase,migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createCustomer,createMachine } from '../src/services/catalog.js';
import { createWorkOrder,transitionWorkOrder } from '../src/services/work-orders.js';
import { saveQuote,approveQuote } from '../src/services/quotes.js';
import { addReceipt,reverseReceipt,financeSummary } from '../src/services/finance.js';
import { createService,openCashSession,createSale,cashSummary } from '../src/services/sales.js';

function setup(){
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
 const c=createCustomer(db,{name:'Cliente canônico'});
 const m=createMachine(db,{customerId:c.id,type:'CARRO'});
 const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Teste financeiro'});
 transitionWorkOrder(db,os.id,'DIAGNOSTICO');
 saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Reparo',quantity:1,unitPriceCents:10000}]});
 approveQuote(db,os.id);
 return{db,os};
}
test('OS/caixa e venda compartilham ledger sem dupla entrada e com idempotência',()=>{
 const{db,os}=setup();
 try {
  openCashSession(db,{openingCents:1000});
  const r1=addReceipt(db,os.id,{amountCents:4000,method:'DINHEIRO',requestId:'receipt-unique-1'});
  const again=addReceipt(db,os.id,{amountCents:4000,method:'DINHEIRO',requestId:'receipt-unique-1'});
  assert.equal(again.id,r1.id);
  assert.throws(()=>addReceipt(db,os.id,{amountCents:1000,method:'DINHEIRO',requestId:'receipt-unique-1'}),/identificador|dados diferentes/i);
  const svc=createService(db,{code:'CANON-SVC',name:'Atendimento avulso',priceCents:2000});
  const sale=createSale(db,{requestId:'sale-unique-1',paymentMethod:'DINHEIRO',items:[{serviceId:svc.id,quantity:1}]});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements').get().n,2);
  assert.equal(cashSummary(db).expectedCashCents,7000);
  assert.equal(financeSummary(db).receivedCents,6000);
  assert.equal(financeSummary(db).invoicedCents,12000);
  assert.equal(sale.total_cents,2000);
  assert.equal(db.prepare('SELECT amount_cents FROM payment_events WHERE source_type=? AND source_id=? AND event_type=?').get('OS_RECEIPT',r1.id,'PAID').amount_cents,4000);
 }finally{db.close();}
});

test('estorno de recebimento OS movimenta caixa e cancela efeito no ledger sem apagar histórico',()=>{
 const{db,os}=setup();
 try{
  openCashSession(db,{openingCents:0});
  const r=addReceipt(db,os.id,{amountCents:5000,method:'DINHEIRO',requestId:'r-reverse-1'});
  reverseReceipt(db,os.id,r.id,{note:'Devolução'});
  assert.equal(db.prepare("SELECT SUM(amount_cents) amount FROM payment_events WHERE source_type='OS_RECEIPT' AND source_id=?").get(r.id).amount,0);
  assert.equal(cashSummary(db).expectedCashCents,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements WHERE receipt_id=?').get(r.id).n,2);
  assert.throws(()=>reverseReceipt(db,os.id,r.id,{note:'Novamente'}),/já estornado/i);
 }finally{db.close();}
});

test('PIX sem caixa registra receita financeira sem inventar movimento de caixa',()=>{
 const{db,os}=setup();
 try{
  addReceipt(db,os.id,{amountCents:3000,method:'PIX',requestId:'r-pix-1'});
  assert.equal(financeSummary(db).receivedCents,3000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
 }finally{db.close();}
});

test('pagamento em espécie exige caixa aberto e recusa cobrança dupla da OS como venda',()=>{
 const{db,os}=setup();
 try{
  assert.throws(()=>addReceipt(db,os.id,{amountCents:1000,method:'DINHEIRO',requestId:'r-cash-no'}),/caixa/i);
  openCashSession(db,{openingCents:0});
  const svc=createService(db,{code:'LINK-SVC',name:'Reparo OS',priceCents:1000});
  assert.throws(()=>createSale(db,{workOrderId:os.id,requestId:'sale-linked-1',paymentMethod:'DINHEIRO',items:[{serviceId:svc.id,quantity:1}]}),/OS|ordem de serviço/i);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
 }finally{db.close();}
});
