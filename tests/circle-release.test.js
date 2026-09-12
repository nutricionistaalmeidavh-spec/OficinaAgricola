import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('CircleCI gera instalador somente em tag de release e mantém publicação externa separada', async () => {
  const [config, publishScript] = await Promise.all([
    read('.circleci/config.yml'),
    read('scripts/publish-circle-artifact.ps1'),
  ]);

  assert.match(config, /desktop_build:/);
  assert.match(config, /desktop_publish:/);
  assert.match(config, /windows-server-2022-gui:current/);
  assert.match(config, /Build Windows x64 installer without external publish/);
  assert.match(config, /electron-builder --win nsis --x64 --publish never/);
  assert.match(config, /store_artifacts:/);
  assert.doesNotMatch(config.split('\n  desktop_build:\n')[1]?.split('\n  desktop_publish:\n')[0] || '', /publish-circle-artifact\.ps1/);
  assert.match(config, /publish-circle-artifact\.ps1/);
  const workflow = config.split('\nworkflows:\n')[1] || '';
  const buildFilter = workflow.split('\n      - desktop_build:\n')[1]?.split('\n      - desktop_publish:\n')[0] || '';
  assert.match(buildFilter, /branches:\s*\n\s*ignore: \/\.\*\//);
  assert.match(buildFilter, /tags:\s*\n\s*only: \/\^v\.\*\//);
  assert.doesNotMatch(buildFilter, /only: main/);
  assert.match(config, /ignore:\s+circle-artifact/);
  assert.match(publishScript, /Get-FileHash/);
  assert.match(publishScript, /45MB/);
  assert.match(publishScript, /HEAD:circle-artifact/);
});
