import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDatabasePath, resolveStoragePath } from '../src/platform/data-location.js';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';

test('nova instalação ignora completamente os bancos históricos mesmo se existirem', () => {
  const cwd='/app';
  const legacy=new Set([
    join(cwd,'data','oficina.sqlite'),
    join(cwd,'data','assistencia-tecnica.sqlite'),
    join(cwd,'apps','assistencia-tecnica','data','assistencia-tecnica.sqlite'),
  ]);
  assert.equal(resolveDatabasePath({cwd,env:{},exists:p=>legacy.has(p)}),join(cwd,'data','artisys-oficina.sqlite'));
});

test('nova instalação usa pasta de anexos exclusiva e ignora diretórios antigos', () => {
  const cwd='/app';
  const db=join(cwd,'data','artisys-oficina.sqlite');
  assert.equal(resolveStoragePath({cwd,env:{},databasePath:db,exists:()=>true}),join(cwd,'storage','uploads'));
});

test('instalador novo tem identidade própria, nome e área de dados isolados', () => {
  const builder=readFileSync('electron-builder.yml','utf8');
  const electron=readFileSync('electron/main.js','utf8');
  const pkg=JSON.parse(readFileSync('package.json','utf8'));
  assert.match(builder,/appId: com\.artisys\.oficina\b/);
  assert.match(builder,/productName: ArtiSys Oficina/);
  assert.match(builder,/ArtiSys-Oficina-Setup-/);
  assert.match(builder,/shortcutName: ArtiSys Oficina/);
  assert.doesNotMatch(builder,/com\.artisys\.assistenciatecnica|OficinaAgro-Setup/);
  assert.match(electron,/join\(local, 'ArtiSys', 'Oficina'\)/);
  assert.match(electron,/join\(root, 'data', 'artisys-oficina\.sqlite'\)/);
  assert.doesNotMatch(electron,/OficinaAgro|AssistenciaTecnica|assistencia-tecnica\.sqlite/);
  assert.equal(pkg.name,'artisys-oficina');
});

test('primeira inicialização identifica produto como ArtiSys Oficina', () => {
  const db=openDatabase(':memory:');
  try {
    migrate(db);
    migrateAssistencia(db);
    assert.equal(db.prepare('SELECT name FROM company_settings WHERE id=1').get().name,'ArtiSys Oficina');
  } finally {db.close();}
  const html=readFileSync('public/index.html','utf8');
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  assert.match(html,/<h1>ArtiSys Oficina<\/h1>/);
  assert.equal(manifest.name,'ArtiSys Oficina');
});
