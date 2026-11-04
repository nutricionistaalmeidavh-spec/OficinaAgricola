import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLegacyNativeRoute} from '../src/platform/native-api-route-map.js';

test('native bridge uses only explicitly supported paths, never a generic /api to /v1 rewrite',()=>{
 assert.equal(mapLegacyNativeRoute('GET','/api/customers')?.path,'/v1/customers');
 assert.equal(mapLegacyNativeRoute('POST','/api/work-orders/17/status')?.path,'/v1/orders/17/status');
 assert.equal(mapLegacyNativeRoute('GET','/api/finance/summary')?.path,'/v1/reports/finance');
 assert.equal(mapLegacyNativeRoute('GET','/api/inventory/low-stock')?.path,'/v1/parts/low-stock');
 for(const route of ['/api/dashboard','/api/public/approval/abcdef','/api/customers/page',
  '/api/company','/api/work-orders/3/documents/orcamento/pdf',
  '/api/customers/3/../expenses','/api/fiscal/1/xml'])
  assert.equal(mapLegacyNativeRoute('GET',route),null,route);
 assert.equal(mapLegacyNativeRoute('DELETE','/api/customers'),null);
});
test('native bridge preserves status and converts legacy receipt and inventory commands',()=>{
 const status=mapLegacyNativeRoute('POST','/api/work-orders/99/status');
 assert.deepEqual(status.mapBody({status:'DIAGNOSTICO',expectedVersion:2}),
  {toStatus:'DIAGNOSTICO',expectedVersion:2});
 const payment=mapLegacyNativeRoute('POST','/api/work-orders/7/receipts');
 assert.deepEqual(payment.mapBody({amountCents:1500,method:'PIX',requestId:'r-1'}),
  {amountCents:1500,method:'PIX',requestId:'r-1',workOrderId:7});
 const stock=mapLegacyNativeRoute('POST','/api/inventory/movements');
 assert.equal(stock.path,'/v1/stock');
 assert.deepEqual(stock.mapBody({partId:3,type:'ENTRADA',quantity:2}),
  {partId:3,type:'ENTRADA',quantity:2});
});
test('bridge enforces the legacy role before the native service role',()=>{
 assert.ok(mapLegacyNativeRoute('GET','/api/fiscal')?.roles.includes('FINANCEIRO'));
 assert.ok(!mapLegacyNativeRoute('GET','/api/fiscal')?.roles.includes('TECNICO'));
 assert.ok(!mapLegacyNativeRoute('POST','/api/customers')?.roles.includes('TECNICO'));
 assert.ok(mapLegacyNativeRoute('POST','/api/work-orders/4/status')?.roles.includes('TECNICO'));
});
