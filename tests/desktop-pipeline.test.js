import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function jobBlock(config, name, nextName) {
  const start = `\n  ${name}:\n`;
  const end = nextName ? `\n  ${nextName}:\n` : '\nworkflows:\n';
  return config.split(start)[1]?.split(end)[0] || '';
}

test('desktop build gera artefato sem depender de publicação externa', async () => {
  const config = await read('.circleci/config.yml');
  const build = jobBlock(config, 'desktop_build', 'desktop_publish');

  assert.match(build, /Build Windows x64 installer/);
  assert.match(build, /store_artifacts:/);
  assert.match(build, /persist_to_workspace:/);
  assert.doesNotMatch(build, /publish-circle-artifact/);
  assert.doesNotMatch(build, /publish-filebin-handoff/);
  assert.doesNotMatch(build, /add_ssh_keys/);
});

test('publicação desktop fica separada e só roda por tag de release', async () => {
  const config = await read('.circleci/config.yml');
  const publish = jobBlock(config, 'desktop_publish', 'assistencia_quality');

  assert.match(publish, /attach_workspace:/);
  assert.match(publish, /publish-filebin-handoff\.ps1/);
  assert.match(publish, /publish-circle-artifact\.ps1/);
  assert.match(publish, /add_ssh_keys/);

  assert.match(config, /- desktop_build:[\s\S]*?branches:\s*\n\s*only: main/);
  assert.match(config, /- desktop_publish:[\s\S]*?requires:[\s\S]*?- desktop_build[\s\S]*?branches:\s*\n\s*ignore: \/\.\*\/[\s\S]*?tags:\s*\n\s*only: \/\^v\.\*\//);
});
