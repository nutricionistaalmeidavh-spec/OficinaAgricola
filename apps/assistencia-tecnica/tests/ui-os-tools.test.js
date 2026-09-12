import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('OS tools are loaded by the app and cached for offline use', async () => {
  const [index, sw] = await Promise.all([read('public/index.html'), read('public/sw.js')]);
  assert.match(index, /src="\/app-os-tools\.js"/);
  assert.match(sw, /\/app-os-tools\.js/);
});

test('OS actions expose editing, audit history, duplication and native PDF download', async () => {
  const js = await read('public/app-os-tools.js');
  assert.match(js, /Editar OS/);
  assert.match(js, /Duplicar OS/);
  assert.match(js, /Histórico/);
  assert.match(js, /Gerar PDF/);
  assert.match(js, /documents\/work-order\/pdf/);
  assert.match(js, /canEdit=\['ADMIN','ATENDIMENTO','TECNICO'\]/);
});
