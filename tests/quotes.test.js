import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder, updateWorkOrder, getWorkOrder } from '../src/services/work-orders.js';
import { saveQuote, submitQuote, approveQuote, rejectQuote, getQuote } from '../src/services/quotes.js';
import { renderDocument } from '../src/documents.js';

function setup(){
  const db=openDatabase(':memory:'); migrate(db);
  const c=createCustomer(db,{name:'Fazenda Horizonte',document:'12345678000190'});
  const m=createMachine(db,{customerId:c.id,type:'Trator',brand:'John Deere',model:'6175M'});
  const os=createWorkOrder(db,{customerId:c.id,machineId:m.id,problemReported:'Perda de força',internalNotes:'NÃO MOSTRAR AO CLIENTE'});
  transitionWorkOrder(db,os.id,'DIAGNOSTICO'); updateWorkOrder(db,os.id,{diagnosis:'Filtro e bomba requerem serviço'});
  return {db,c,m,os};
}

test('saves quote with parts labor and third-party items and computes total',()=>{
  const {db,os}=setup();
  const quote=saveQuote(db,os.id,{discountCents:1000,items:[
    {kind:'PECA',description:'Filtro',quantity:2,unitPriceCents:5000},
    {kind:'MAO_DE_OBRA',description:'Revisão',quantity:3,unitPriceCents:10000},
    {kind:'TERCEIRO',description:'Retífica',quantity:1,unitPriceCents:20000}
  ]});
  assert.equal(quote.subtotal_cents,60000); assert.equal(quote.total_cents,59000);
  assert.equal(getWorkOrder(db,os.id).status,'ORCAMENTO');
  assert.equal(getQuote(db,os.id).items.length,3);
  db.close();
});

test('submits and approves quote while snapshotting total on OS',()=>{
  const {db,os}=setup(); saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:15000}]});
  submitQuote(db,os.id); assert.equal(getWorkOrder(db,os.id).status,'AGUARDANDO_APROVACAO');
  approveQuote(db,os.id); const after=getWorkOrder(db,os.id);
  assert.equal(after.status,'APROVADA'); assert.equal(after.quote_total_cents,15000);
  assert.equal(getQuote(db,os.id).approval_status,'APROVADO');
  db.close();
});

test('rejects quote with recorded reason',()=>{
  const {db,os}=setup(); saveQuote(db,os.id,{items:[{kind:'PECA',description:'Peça',quantity:1,unitPriceCents:1000}]}); submitQuote(db,os.id);
  rejectQuote(db,os.id,'Cliente não autorizou');
  const q=getQuote(db,os.id); assert.equal(q.approval_status,'REPROVADO'); assert.equal(q.rejection_reason,'Cliente não autorizou'); assert.equal(getWorkOrder(db,os.id).status,'REPROVADA');
  db.close();
});

test('renders printable customer document without internal notes',()=>{
  const {db,os}=setup(); saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Diagnóstico',quantity:1,unitPriceCents:12000}]});
  const html=renderDocument(db,os.id,'quote');
  assert.match(html,/Fazenda Horizonte/); assert.match(html,/6175M/); assert.match(html,/120,00/); assert.equal(html.includes('NÃO MOSTRAR AO CLIENTE'),false);
  db.close();
});
