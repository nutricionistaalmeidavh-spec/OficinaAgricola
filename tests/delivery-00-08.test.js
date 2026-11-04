import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('entregas 00-08 permanecem isoladas e sem dependência SaaS de runtime', async () => {
  const [pkgText, env, builder, start, schema, server, ui, sw, docs, readme] = await Promise.all([
    read('package.json'),
    read('.env.example'),
    read('electron-builder.yml'),
    read('src/start.js'),
    read('src/assistencia-schema.js'),
    read('src/server-assistencia.js'),
    read('public/index.html'),
    read('public/sw.js'),
    read('src/documents.js'),
    read('README.md'),
  ]);
  const pkg = JSON.parse(pkgText);

  assert.equal(pkg.name, 'artisys-oficina');
  assert.ok(pkg.dependencies && typeof pkg.dependencies.pg==='string' && /^\^8\./.test(pkg.dependencies.pg),
    'PostgreSQL OSS é dependência local empacotada, não SaaS');
  assert.deepEqual(Object.keys(pkg.dependencies),['pg']);
  assert.equal(pkg.devDependencies, undefined);
  assert.match(env, /PORT=3344/);
  assert.match(env, /OFICINA_POSTGRES_REGISTRY_URL=/);
  assert.match(env, /OFICINA_POSTGRES_OPERATIONS_URL=/);
  assert.doesNotMatch(env, /DATABASE_PATH=|OFICINA_DATABASE_ENGINE=sqlite/);
  assert.ok(builder.includes('appId: com.artisys.oficina'));
  assert.match(start, /createAssistenciaServer/);

  for (const table of ['service_catalog', 'cash_sessions', 'sales', 'sale_items', 'sale_stock_movements', 'cash_movements']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  for (const route of ['/api/services', '/api/sales', '/api/cash/open', '/api/cash/current/summary']) {
    assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
  }

  assert.match(ui, /data-page="work-orders"/);
  assert.match(ui, /data-page="machines"/);
  assert.match(ui, /data-page="services"/);
  assert.match(ui, /data-page="inventory"/);
  assert.match(ui, /data-page="sales"/);
  assert.match(ui, /data-page="finance"/);
  assert.match(ui, /data-page="reports"/);
  assert.match(sw, /\/app-assistencia\.js/);
  assert.match(docs, /<strong>Equipamento<\/strong>/);
  assert.match(docs, /ArtiSys Oficina/);
  assert.match(readme, /R\$ 0/);
  assert.match(readme, /nenhuma API[^\n]*SaaS pago[^\n]*obrigatório/i);
});
