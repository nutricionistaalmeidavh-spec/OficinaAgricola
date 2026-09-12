import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveServerConfig, listLanUrls } from '../src/platform/network.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = path => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Assistência Técnica usa 3344 e escuta a rede local por padrão', () => {
  assert.deepEqual(resolveServerConfig({}), { host: '0.0.0.0', port: 3344 });
  assert.deepEqual(listLanUrls({ interfaces: { eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] } }), ['http://192.168.1.20:3344']);
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

  assert.match(sw, /assistencia-tecnica-shell-v2/);
  assert.match(sw, /local-runtime\.css/);
  assert.match(sw, /local-runtime\.js/);
  assert.match(sw, /cacheFirstStatic/);
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
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.optionalDependencies, undefined);
  assert.doesNotMatch(runtime, /https?:\/\//);
  assert.doesNotMatch(sw, /https?:\/\//);
});

test('instalador fica bloqueado em entregas intermediárias e só roda em tag v*', async () => {
  const circle = await readRepo('.circleci/config.yml');
  const workflow = circle.split('\nworkflows:\n')[1] || '';
  const build = workflow.split('\n      - desktop_build:\n')[1]?.split('\n      - desktop_publish:\n')[0] || '';
  const assistBuild = workflow.split('\n      - assistencia_windows_build:\n')[1] || '';

  assert.match(build, /branches:\s*\n\s*ignore: \/\.\*\//);
  assert.match(build, /tags:\s*\n\s*only: \/\^v\.\*\//);
  assert.doesNotMatch(build, /only: main/);
  assert.doesNotMatch(assistBuild, /feature\/assistencia-entrega-10-local-offline/);
});
