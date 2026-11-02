import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('build desktop da assistência é independente e não exige publicação externa', async () => {
  const [builder, buildScript, pkg] = await Promise.all([
    read('electron-builder.yml'),
    read('scripts/build-electron.ps1'),
    read('package.json'),
  ]);

  assert.match(builder, /appId: com\.artisys\.assistenciatecnica/);
  assert.match(builder, /productName: ArtiSys Oficina/);
  assert.match(builder, /ArtiSys-Oficina-Setup-/);
  assert.match(buildScript, /ArtiSys-Oficina-Setup-/);
  assert.doesNotMatch(pkg, /publish|filebin|circleci/i);
});
