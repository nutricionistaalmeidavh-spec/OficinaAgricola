import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('toast não intercepta menu mobile enquanto informa conclusão da operação',()=>{
  const css=readFileSync('public/ui-stage7.css','utf8');
  assert.match(css,/\.toast\s*\{[^}]*pointer-events\s*:\s*none\b/);
});

test('QA só sai do histórico após confirmação real de garantia e fechamento do modal',()=>{
  const qa=readFileSync('scripts/qa-demo.mjs','utf8');
  assert.match(qa,/getByRole\('status'\)\.filter\(\{hasText:'Garantia registrada'\}\)\.waitFor/);
  assert.match(qa,/await page\.locator\('#modalClose'\)\.click\(\);\s*await page\.locator\('#modal'\)\.waitFor\(\{state:'hidden'\}\);\s*await navigateQa\(page,'fiscal'\)/);
});
