import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createCustomer, createMachine } from '../src/services/catalog.js';
import { createWorkOrder, transitionWorkOrder } from '../src/services/work-orders.js';
import { saveQuote, approveQuote } from '../src/services/quotes.js';
import { createPart } from '../src/services/inventory.js';
import { getOperationalReport } from '../src/services/reports.js';
import { migrateFiscal, createFiscalDraft, getFiscalDocument, submitFiscalDocument, listFiscalDocuments } from '../src/services/fiscal.js';
import {setFiscalSettings} from '../src/services/fiscal-settings.js';

function fixture() {
  const db=openDatabase(':memory:');
  migrate(db); migrateAssistencia(db); migrateFiscal(db);
  const customer=createCustomer(db,{name:'Cliente P0',document:'12345678901'});
  const machine=createMachine(db,{customerId:customer.id,type:'CARRO',brand:'VW',model:'Gol'});
  return {db,customer,machine};
}

test('P0 relatórios contam todo o histórico, mês de entrega e estoque crítico sem cortes em 200/8', () => {
  const {db,customer,machine}=fixture();
  try {
    const deliveredAt='2026-11-02T13:00:00.000Z';
    for(let i=0;i<235;i++){
      const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Revisão '+i});
      db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at=? WHERE id=?").run(deliveredAt,os.id);
    }
    const open=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Pendente'});
    for(let i=0;i<12;i++) createPart(db,{sku:'P0-'+i,description:'Peça '+i,minStock:2});
    const report=getOperationalReport(db,{from:'2026-11-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z'});
    assert.equal(report.deliveredCount,235);
    assert.equal(report.openCount,1);
    assert.equal(report.lowStockCount,12);
    assert.equal(report.statusCounts.ENTREGUE,235);
    assert.equal(report.statusCounts.ENTRADA,1);
    assert.equal(db.prepare('SELECT status FROM work_orders WHERE id=?').get(open.id).status,'ENTRADA');
  } finally { db.close(); }
});

test('P0 fiscal: OS gera snapshots independentes para peças e mão de obra, sem dupla cobrança', () => {
  const {db,customer,machine}=fixture();
  try {
    const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Revisão'});
    transitionWorkOrder(db,os.id,'DIAGNOSTICO');
    saveQuote(db,os.id,{discountCents:1000,items:[
      {kind:'PECA',description:'Filtro',quantity:1,unitPriceCents:60000},
      {kind:'MAO_DE_OBRA',description:'Troca',quantity:1,unitPriceCents:40000}
    ]});
    approveQuote(db,os.id);
    const nfe=createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFE',requestId:'os-1-nfe'});
    const nfse=createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFSE',requestId:'os-1-nfse'});
    assert.equal(nfe.amount_cents,59400);
    assert.equal(nfse.amount_cents,39600);
    assert.equal(nfe.status,'RASCUNHO');
    assert.equal(nfse.status,'RASCUNHO');
    assert.equal(JSON.parse(nfe.snapshot_json).originId,os.id);
    assert.equal(createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFE',requestId:'os-1-nfe'}).id,nfe.id);
    assert.equal(createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFE',requestId:'os-1-another'}).id,nfe.id);
    assert.equal(listFiscalDocuments(db).length,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
  } finally { db.close(); }
});

test('P0 fiscal: terceiro e item sem classificação não podem gerar nota automaticamente', () => {
  const {db,customer,machine}=fixture();
  try{
    const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Revisão'});
    transitionWorkOrder(db,os.id,'DIAGNOSTICO');
    saveQuote(db,os.id,{items:[{kind:'TERCEIRO',description:'Serviço de outra empresa',quantity:1,unitPriceCents:10000}]});
    approveQuote(db,os.id);
    assert.throws(()=>createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFSE',requestId:'x'}),/classifica|terceir|tribut/i);
    assert.equal(listFiscalDocuments(db).length,0);
  }finally{db.close()}
});

test('P0 fiscal: sem provider homologado não há autorização fictícia nem alteração de estoque/caixa', async () => {
  const {db,customer,machine}=fixture();
  try{
    const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Revisão'});
    transitionWorkOrder(db,os.id,'DIAGNOSTICO');
    saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:12345}]});
    approveQuote(db,os.id);
    const fiscal=createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFSE',requestId:'nfse-one'});
    await assert.rejects(()=>submitFiscalDocument(db,fiscal.id),/provider|emissor|configurad/i);
    assert.equal(getFiscalDocument(db,fiscal.id).status,'RASCUNHO');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
  }finally{db.close()}
});

test('P0 fiscal: perda de resposta fica indeterminada e não autoriza reenvio cego', async () => {
  const {db,customer,machine}=fixture();
  try{
    const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Serviço'});
    transitionWorkOrder(db,os.id,'DIAGNOSTICO');
    saveQuote(db,os.id,{items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:5000}]});
    approveQuote(db,os.id);
    const draft=createFiscalDraft(db,{originType:'OS',originId:os.id,kind:'NFSE',requestId:'one'});
    setFiscalSettings(db,{issuerCnpj:'11222333000181',issuerUf:'MG',municipalityIbge:'3170107',taxRegime:'SIMPLES',enabled:true});
    let calls=0;const provider={transmit:async()=>{calls++;throw new Error('resposta perdida')}};
    await assert.rejects(()=>submitFiscalDocument(db,draft.id,{provider}),/resposta perdida/);
    assert.equal(getFiscalDocument(db,draft.id).status,'INDETERMINADO');
    await assert.rejects(()=>submitFiscalDocument(db,draft.id,{provider}),/indeterminad|concilia|consulta/i);
    assert.equal(calls,1);
  }finally{db.close()}
});
