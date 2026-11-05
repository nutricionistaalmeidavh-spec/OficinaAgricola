import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = name => readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const sales = source('app-assistencia.js');
const orders = source('app-orders.js');
const fiscal = source('app-fiscal.js');
const css = source('ui-stage7.css');

test('P0: venda manual exige conferência explícita em meios eletrônicos sem remover meios de pagamento',()=>{
  assert.match(sales,/id="salePaymentVerified"/);
  assert.match(sales,/function updateSalePaymentVerification|const updateSalePaymentVerification/);
  assert.match(sales,/Pagamento não conferido/);
  for(const method of ['DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO','TRANSFERENCIA'])
    assert.match(sales,new RegExp('<option>'+method+'</option>'));
  assert.match(sales,/id="salePreview"/);
});
test('P0: OS tem próximo passo destacado e todos os atalhos financeiros permanecem encontráveis',()=>{
  assert.match(orders,/id="nextOsAction"/);
  assert.match(orders,/function osPrimaryAction|const osPrimaryAction/);
  assert.match(orders,/id="receivePaymentBtn"/);
  for(const action of ['payBtn','collectBtn','billingPlanBtn','quoteBtn','partBtn','checkBtn','photoBtn'])
    assert.match(orders,new RegExp('id="'+action+'"'));
  assert.match(orders,/id="verifiedManualReceipt"/);
});
test('P1: fiscal orienta o próximo passo sem ocultar nenhuma configuração existente',()=>{
  assert.match(fiscal,/id="fiscalQuickPath"/);
  for(const button of ['fiscalNew','fiscalSettings','fiscalTaxProfiles','fiscalCertA1','fiscalCertA3','fiscalDiagnose'])
    assert.match(fiscal,new RegExp('id=\\"'+button+'\\"'));
});
test('P2: estados e acessibilidade mobile com botões descobríveis',()=>{
  assert.match(css,/\.os-next-action/);
  assert.match(css,/\.sales-payment-verification/);
  assert.match(css,/\.fiscal-quick-path/);
  assert.match(css,/@media\(max-width:840px\)/);
});

test('regressão: HTML e coleções JS preservam recursos no browser',()=>{
  assert.match(orders,/<div class="detail-grid">/);
  assert.doesNotMatch(orders,/<div class="detail-grid'>/);
  assert.ok(sales.includes("const items = $$('.sale-item-row').map"));
  assert.ok(orders.includes("$$('[data-reverse-part]').forEach"));
  assert.ok(orders.includes("$$('[data-reverse-receipt]').forEach"));
  assert.ok(fiscal.includes("$$('[data-tax-edit]').forEach"));
});
