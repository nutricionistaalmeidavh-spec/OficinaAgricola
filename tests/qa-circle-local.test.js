import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('CircleCI QA usa runner local sem clone privado do utilidades', async () => {
  const config = await read('.circleci/config.yml');
  const qaJob = config.split('\n  qa:\n')[1]?.split('\n  desktop_release:\n')[0] || '';

  assert.match(qaJob, /scripts\/seed-qa-demo\.mjs/);
  assert.match(qaJob, /scripts\/qa-demo\.mjs << parameters\.viewport >>/);
  assert.match(qaJob, /playwright@1\.62\.1/);
  assert.doesNotMatch(qaJob, /git clone/);
  assert.doesNotMatch(qaJob, /utilidades/);
  assert.doesNotMatch(qaJob, /add_ssh_keys/);
  assert.doesNotMatch(qaJob, /ARTISYS_QA_REF/);
});

test('manifesto QA inicia seed e servidor a partir da raiz do projeto', async () => {
  const manifest = JSON.parse(await read('qa/artisys-qa.config.json'));
  const local = manifest.environments.local;

  assert.equal(local.env.DATABASE_PATH, '.qa/oficina.sqlite');
  assert.equal(local.env.STORAGE_DIR, '.qa/uploads');
  assert.match(local.startCommand, /^cd \.\. && /);
  assert.match(local.startCommand, /node scripts\/seed-qa-demo\.mjs/);
  assert.match(local.startCommand, /npm start$/);
  assert.doesNotMatch(local.startCommand, /node \.\.\/scripts/);
});
