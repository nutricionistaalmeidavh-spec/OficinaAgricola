import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('instalador ArtiSys Oficina tem ID e nome próprios e não faz publicação externa', async () => {
  const [builder, buildScript, pkg] = await Promise.all([
    read('electron-builder.yml'),
    read('scripts/build-electron.ps1'),
    read('package.json'),
  ]);
  assert.ok(builder.includes('appId: com.artisys.oficina'));
  assert.ok(builder.includes('productName: ArtiSys Oficina'));
  assert.ok(builder.includes('ArtiSys-Oficina-Setup-'));
  assert.ok(builder.includes('shortcutName: ArtiSys Oficina'));
  assert.ok(buildScript.includes('ArtiSys-Oficina-Setup-'));
  assert.ok(buildScript.includes('--publish never'));
  assert.doesNotMatch(pkg, /publish|filebin|circleci/i);
});
