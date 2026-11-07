import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');

test('Electron inicia PostgreSQL 16 privado e não executa SQLite nem fallback',()=>{
 assert.match(source,/return join\(local, 'ArtiSys', 'Oficina'\);/);
 assert.match(source,/const url = await startPostgresDesktop\(\);/);
 assert.match(source,/createPortablePostgresController/);
 assert.match(source,/const port=3344;/);
 assert.match(source,/serverUrl='http:\/\/127\.0\.0\.1:'\+port/);
 assert.match(source,/OFICINA_POSTGRES_MANAGED_LOCAL:'true'/);
 assert.match(source,/OFICINA_POSTGRES_PROVISION_NEW_UNITS:'true'/);
 assert.doesNotMatch(source,/configureBundledFiscal/);
 assert.doesNotMatch(source,/\.sqlite|startLocalServer|migrateAssistencia\(db\)|openDatabase/);
 assert.doesNotMatch(source,/assistencia-tecnica\.sqlite|OficinaAgro/);
});
