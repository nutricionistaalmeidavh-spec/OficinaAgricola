import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('Only GitHub Actions performs automated CI and desktop/mobile QA', () => {
  assert.equal(existsSync('.circleci/config.yml'),false);
  const ci=readFileSync('.github/workflows/ci.yml','utf8');
  const qa=readFileSync('.github/workflows/artisys-qa-stage7.yml','utf8');
  assert.match(ci,/npm run ci|npm run lint/);
  assert.match(ci,/pull_request:/);
  assert.match(qa,/matrix:/);
  assert.match(qa,/desktop/);
  assert.match(qa,/mobile/);
  assert.match(qa,/scripts\/qa-demo\.mjs/);
});
