import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

// Regression contracts: the UI must not bypass the safe user workflow.
test('canceling a sale needs an explicit confirmation and a reason', () => {
  const ui = read('public/app-assistencia.js');
  const service = read('src/services/sales.js');
  assert.doesNotMatch(ui, /\bprompt\s*\(/, 'Native prompt can cancel a sale after pressing Cancel');
  assert.match(ui, /function cancelSaleModal\(/);
  assert.match(ui, /name="reason"[^>]*required/);
  assert.match(service, /Motivo do cancelamento obrigatório/);
});

test('fiscal draft originates from selectable OS or sale, not opaque numeric IDs', () => {
  const fiscal = read('public/app-fiscal.js');
  assert.match(fiscal, /id="fiscalOriginSearch"/);
  assert.match(fiscal, /id="fiscalOriginOptions"/);
  assert.match(fiscal, /api\/work-orders\/page\?/);
  assert.match(fiscal, /api\/sales\?limit=/);
  assert.doesNotMatch(fiscal, /ID interno da OS\/venda/);
});

test('fiscal transmission handles pending and confirmed states without silent resends', () => {
  const fiscal = read('public/app-fiscal.js');
  assert.match(fiscal, /fiscalBusy/);
  assert.match(fiscal, /Consultar situação/);
  assert.match(fiscal, /aria-busy/);
  assert.match(fiscal, /Transmissão solicitada|Situação fiscal atualizada/);
});

test('accessible entry, mobile fiscal actions and product copy', () => {
  const html = read('public/index.html');
  const css = read('public/ui-stage7.css');
  const operations = read('public/app-operations.js');
  const stage = read('public/app-stage7.js');
  assert.doesNotMatch(html, /name="username" autocomplete="username" value="admin"/);
  assert.match(html, /id="loginError"[^>]*role="alert"/);
  assert.match(css, /\.fiscal-head/);
  assert.match(css, /input\[type="checkbox"\]/);
  assert.doesNotMatch(operations, /ENTREGA 06/);
  assert.doesNotMatch(stage, /Máquina não informada/);
});
