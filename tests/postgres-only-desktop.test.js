import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Electron inicia PostgreSQL automaticamente em instalação limpa e não possui fallback SQLite',async()=>{
 const main=await source('electron/main.js');
 assert.match(main,/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?const url = await startPostgresDesktop\(\);/);
 assert.doesNotMatch(main,/startLocalServer|openDatabase|artisys-oficina\.sqlite|OFICINA_POSTGRES_DESKTOP_MODE/);
 assert.match(main,/createPortablePostgresController/);
 assert.doesNotMatch(main,/configureBundledFiscal/);
});

test('comandos padrão usam somente PostgreSQL e servidor SQLite legado não inicia',async()=>{
 const pkg=JSON.parse(await source('package.json'));
 assert.equal(pkg.scripts.start,'node src/start-postgres-unified.js');
 assert.equal(pkg.scripts.dev,'node --watch src/start-postgres-unified.js');
 assert.ok(pkg.dependencies.pg);
});

test('smokes de instalador verificam modo PostgreSQL normal sem ativador nem banco SQLite',async()=>{
 const [installer,portable]=await Promise.all([
  source('scripts/smoke-installer.ps1'),
  source('scripts/smoke-postgres-portable.ps1')
 ]);
 assert.doesNotMatch(installer,/artisys-oficina\.sqlite|events\.jsonl|EventBus do desktop/);
 assert.doesNotMatch(portable,/OFICINA_POSTGRES_DESKTOP_MODE/);
 assert.match(portable,/engine -eq 'postgres'/);
 assert.match(portable,/Get-FileHash \$secret/);
});
