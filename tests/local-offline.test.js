import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveServerConfig, listLanUrls } from '../src/platform/network.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Assistência Técnica usa 3344 e escuta somente loopback por padrão', () => {
  assert.deepEqual(resolveServerConfig({}), { host: '127.0.0.1', port: 3344 });
  assert.deepEqual(listLanUrls({ interfaces: { eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] } }), ['https://192.168.1.20:3344']);
});

test('UI mostra estado do servidor local e transforma falha de rede em mensagem útil', async () => {
  const [html, runtime, core] = await Promise.all([
    read('public/index.html'),
    read('public/local-runtime.js'),
    read('public/app-core.js'),
  ]);

  assert.match(html, /id="serverStatus"/);
  assert.match(html, /local-runtime\.js/);
  assert.match(runtime, /Servidor local disponível/);
  assert.match(runtime, /Servidor local indisponível/);
  assert.match(runtime, /checkServerStatus/);
  assert.match(runtime, /setInterval\(checkServerStatus, 15000\)/);
  assert.match(core, /window\.localRuntime\?\.request\|\|fetch/);
});

test('PWA mantém shell local em cache sem interceptar a API', async () => {
  const [sw, manifest] = await Promise.all([
    read('public/sw.js'),
    read('public/manifest.webmanifest'),
  ]);

  assert.match(sw, /artisys-oficina-shell-v\d+/);
  assert.match(sw, /local-runtime\.css/);
  assert.match(sw, /obd-serial\.js/);
  assert.match(sw, /local-runtime\.js/);
  assert.match(sw, /networkFirstStatic/);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  const data = JSON.parse(manifest);
  assert.equal(data.display, 'standalone');
  assert.equal(data.start_url, '/');
});

test('núcleo local não exige API ou SaaS externo', async () => {
  const [pkgText, runtime, sw] = await Promise.all([
    read('package.json'),
    read('public/local-runtime.js'),
    read('public/sw.js'),
  ]);
  const pkg = JSON.parse(pkgText);
  assert.ok(pkg.dependencies && typeof pkg.dependencies.pg==='string' && /^\^8\./.test(pkg.dependencies.pg),
    'PostgreSQL OSS é dependência local empacotada, não SaaS');
  assert.deepEqual(Object.keys(pkg.dependencies),['pg']);
  assert.equal(pkg.optionalDependencies, undefined);
  assert.doesNotMatch(runtime, /https?:\/\//);
  assert.doesNotMatch(sw, /https?:\/\//);
});

test('o pipeline GitHub Actions não publica instaladores automaticamente', async () => {
  const ci=await readRepo('.github/workflows/ci.yml');
  const qa=await readRepo('.github/workflows/artisys-qa-stage7.yml');
  assert.match(ci,/pull_request:/);
  assert.match(qa,/matrix:/);
  assert.doesNotMatch(ci+qa,/desktop_publish|publish-filebin|desktop_build/);
});


test('links privados de aprovação não entram no cache de navegação do PWA',async()=>{
 const sw=await read('public/sw.js');
 assert.match(sw,/url\.pathname\s*===\s*'\/approval\.html'\)\s*return/);
});
