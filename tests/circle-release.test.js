import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('CircleCI gera o instalador no main e publica apenas por tag de release', async () => {
  const [config, buildScript, publishScript] = await Promise.all([
    read('.circleci/config.yml'),
    read('scripts/build-electron.ps1'),
    read('scripts/publish-circle-artifact.ps1'),
  ]);

  assert.match(config, /desktop_build:/);
  assert.match(config, /desktop_publish:/);
  assert.match(config, /windows-server-2022-gui:current/);
  assert.match(config, /Build Windows x64 installer/);
  assert.match(config, /store_artifacts:/);
  assert.match(config, /persist_to_workspace:/);
  assert.match(config, /attach_workspace:/);
  assert.match(config, /publish-circle-artifact\.ps1/);
  assert.match(config, /only:\s+main/);
  assert.match(config, /only:\s+\/\^v\.\*\//);
  assert.match(config, /ignore:\s+circle-artifact/);
  assert.match(buildScript, /if \(-not \$env:CI\)/);
  assert.match(publishScript, /Get-FileHash/);
  assert.match(publishScript, /45MB/);
  assert.match(publishScript, /HEAD:circle-artifact/);
});
