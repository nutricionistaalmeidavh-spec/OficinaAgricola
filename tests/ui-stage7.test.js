import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('etapa 07 exposes the definitive Oficina Agro shell', async () => {
  const html = await read('public/index.html');
  assert.match(html, /Oficina Agro/);
  assert.match(html, /id="globalSearch"/);
  assert.match(html, /data-page="reports"/);
  assert.match(html, /href="\/ui-stage7\.css"/);
  assert.match(html, /src="\/app-stage7\.js"/);
});

test('etapa 07 visual layer stays isolated from business rules', async () => {
  const css = await read('public/ui-stage7.css');
  const js = await read('public/app-stage7.js');
  assert.match(css, /--oa-green:/);
  assert.match(css, /@media\(max-width:840px\)/);
  assert.match(js, /function renderReports/);
  assert.match(js, /function bindGlobalSearch/);
  assert.doesNotMatch(js, /INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
});

test('ArtiSys QA consumer is configured without becoming a runtime dependency', async () => {
  const manifest = JSON.parse(await read('qa/artisys-qa.config.json'));
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(manifest.systemId, 'oficina-agro');
  assert.equal(manifest.mode, 'web');
  assert.equal(manifest.defaultFlow, 'stage7-shell');
  assert.ok(manifest.flows['stage7-shell']);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
