import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function jobBlock(config, name, nextName) {
  const start = `\n  ${name}:\n`;
  const end = nextName ? `\n  ${nextName}:\n` : '\nworkflows:\n';
  return config.split(start)[1]?.split(end)[0] || '';
}

test('desktop build gera instalador diretamente sem publicação nem workspace', async () => {
  const config = await read('.circleci/config.yml');
  const build = jobBlock(config, 'desktop_build', 'desktop_publish');

  assert.match(build, /npm ci/);
  assert.match(build, /npm run build/);
  assert.match(build, /electron-builder@26\.15\.3/);
  assert.match(build, /electron-builder --win nsis --x64 --publish never/);
  assert.match(build, /OficinaAgro-Setup-\*-Windows-x64\.exe/);
  assert.match(build, /store_artifacts:/);
  assert.doesNotMatch(build, /build-electron\.ps1/);
  assert.doesNotMatch(build, /persist_to_workspace:/);
  assert.doesNotMatch(build, /publish-circle-artifact/);
  assert.doesNotMatch(build, /publish-filebin-handoff/);
  assert.doesNotMatch(build, /add_ssh_keys/);
});

test('publicação desktop recompila o instalador e só roda por tag de release', async () => {
  const config = await read('.circleci/config.yml');
  const publish = jobBlock(config, 'desktop_publish', 'assistencia_quality');

  assert.match(publish, /npm run build/);
  assert.match(publish, /electron-builder --win nsis --x64 --publish never/);
  assert.match(publish, /publish-filebin-handoff\.ps1/);
  assert.match(publish, /publish-circle-artifact\.ps1/);
  assert.match(publish, /add_ssh_keys/);
  assert.doesNotMatch(publish, /attach_workspace:/);

  assert.match(config, /- desktop_build:[\s\S]*?branches:\s*\n\s*only: main/);
  assert.match(config, /- desktop_publish:[\s\S]*?requires:[\s\S]*?- desktop_build[\s\S]*?branches:\s*\n\s*ignore: \/\.\*\/[\s\S]*?tags:\s*\n\s*only: \/\^v\.\*\//);
});
