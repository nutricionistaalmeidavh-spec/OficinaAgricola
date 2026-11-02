import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder } from '../src/services/work-orders.js';
import { saveQuote, submitQuote, approveQuote, getQuote } from '../src/services/quotes.js';

const read=p=>readFileSync(p,'utf8');

test('CANON: somente o agregado OS pode gravar status e histórico de transição',()=>{
  const quotes=read('src/services/quotes.js');
  const orders=read('src/services/work-orders.js');
  assert.doesNotMatch(quotes,/UPDATE\s+work_orders\s+SET\s+status\s*=/i);
  assert.doesNotMatch(quotes,/INSERT\s+INTO\s+work_order_status_history/i);
  assert.match(quotes,/transitionWorkOrderInTransaction/);
  assert.match(orders,/export function transitionWorkOrderInTransaction/);
});

test('CANON: aprovação do orçamento mantém status, histórico e total coerentes',()=>{
  const db=openDatabase(':memory:');
  try{
    migrate(db);migrateAssistencia(db);
    const c=createCustomer(db,{name:'Cliente P0'});
    const m=createMachine(db,{customerId:c.id,type:'CARRO',brand:'Fiat',model:'Uno'});
    const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Revisão'});
    transitionWorkOrder(db,os.id,'DIAGNOSTICO');
    saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Diagnóstico',quantity:1,unitPriceCents:15000}]});
    submitQuote(db,os.id);
    approveQuote(db,os.id);
    const actual=db.prepare('SELECT status,quote_total_cents FROM work_orders WHERE id=?').get(os.id);
    const history=db.prepare('SELECT to_status FROM work_order_status_history WHERE work_order_id=? ORDER BY id').all(os.id).map(x=>x.to_status);
    assert.equal(actual.status,'APROVADA');
    assert.equal(actual.quote_total_cents,getQuote(db,os.id).total_cents);
    assert.deepEqual(history,['ENTRADA','DIAGNOSTICO','ORCAMENTO','AGUARDANDO_APROVACAO','APROVADA']);
  }finally{db.close()}
});

test('CANON UI: uma única navegação, sem sobrescrita de funções globais',()=>{
  const core=read('public/app-core.js');
  const extension=read('public/app-assistencia.js');
  const osTools=read('public/app-os-tools.js');
  const orders=read('public/app-orders.js');
  assert.match(core,/services:\s*renderServices/);
  assert.match(core,/sales:\s*renderSales/);
  assert.match(core,/pageReady/);
  assert.match(core,/AbortController/);
  assert.doesNotMatch(extension,/\b(?:navigate|renderMachines|openWorkOrder|workOrderModal)\s*=/);
  assert.doesNotMatch(osTools,/\bopenWorkOrder\s*=/);
  assert.match(orders,/enhanceWorkOrderModal\(id,\s*os\)/);
});

test('CANON UI: etiquetas são definidas na fonte, sem relabel pós-render',()=>{
  const extension=read('public/app-assistencia.js');
  const orders=read('public/app-orders.js');
  assert.doesNotMatch(extension,/relabelAssistenciaModal|assistenciaBaseRenderMachines/);
  assert.match(orders,/<h3>Equipamento<\/h3>/);
  assert.match(orders,/<label>Equipamento<select/);
});

test('CANON: escritores de estoque/caixa não podem voltar para módulos paralelos',()=>{
  const sales=read('src/services/sales.js');
  const finance=read('src/services/finance.js');
  const inventory=read('src/services/inventory.js');
  const payments=read('src/services/payment-ledger.js');
  assert.doesNotMatch(sales,/UPDATE\s+parts\s+SET\s+quantity/i);
  assert.doesNotMatch(sales,/INSERT\s+INTO\s+(?:inventory_movements|sale_stock_movements|cash_movements|payment_events)/i);
  assert.doesNotMatch(finance,/INSERT\s+INTO\s+(?:cash_movements|payment_events)/i);
  assert.match(inventory,/export function postStockMovement/);
  assert.match(payments,/export function postPaymentEvent/);
  assert.match(payments,/export function postCashMovement/);
});
