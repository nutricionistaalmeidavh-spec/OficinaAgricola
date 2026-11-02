import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('shell definitivo identifica a edição Assistência Técnica', async () => {
  const html = await read('public/index.html');
  assert.match(html, /ArtiSys Oficina/);
  assert.match(html, /id="globalSearch"/);
  assert.match(html, /data-page="reports"/);
  assert.match(html, /data-page="services"/);
  assert.match(html, /data-page="sales"/);
  assert.match(html, /href="\/ui-stage7\.css"/);
  assert.match(html, /src="\/app-stage7\.js"/);
  assert.match(html, /src="\/app-assistencia\.js"/);
});

test('camada visual base permanece isolada das regras de negócio', async () => {
  const css = await read('public/ui-stage7.css');
  const js = await read('public/app-stage7.js');
  assert.match(css, /--oa-green:/);
  assert.match(css, /@media\(max-width:840px\)/);
  assert.match(js, /function renderReports/);
  assert.match(js, /function bindGlobalSearch/);
  assert.match(js, /item\.internal_id/);
  assert.doesNotMatch(js, /item\.identifier/);
  assert.doesNotMatch(js, /INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
});

test('ArtiSys QA fica configurado como consumidor opcional da assistência', async () => {
  const manifest = JSON.parse(await read('qa/artisys-qa.config.json'));
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(manifest.systemId, 'artisys-oficina');
  assert.equal(manifest.mode, 'web');
  assert.equal(manifest.defaultFlow, 'stage7-shell');
  assert.equal(manifest.environments.local.baseURL, 'http://127.0.0.1:3344');
  assert.ok(manifest.flows['stage7-shell']);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
