import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');

test('Electron ArtiSys Oficina inicia com banco novo e expõe LAN na porta 3344', () => {
  const argvGuard = source.indexOf("if (!process.argv[1]) process.argv[1] = fileURLToPath(import.meta.url)");
  const serverImport = source.indexOf("import('../dist/src/server-assistencia.js')");
  assert.ok(argvGuard >= 0, 'Electron deve normalizar process.argv[1] no build empacotado');
  assert.ok(serverImport > argvGuard, 'backend deve ser importado depois de normalizar argv');
  assert.ok(source.includes("return join(local, 'ArtiSys', 'Oficina');"));
  assert.ok(source.includes("join(root, 'data', 'artisys-oficina.sqlite')"));
  assert.ok(!source.includes('assistencia-tecnica.sqlite'));
  assert.ok(!source.includes('OficinaAgro'));
  assert.ok(source.includes("process.env.HOST='0.0.0.0'"));
  assert.ok(source.includes("process.env.PORT='3344'"));
  assert.match(source, /migrate\(db\);/);
  assert.match(source, /migrateAssistencia\(db\);/);
  assert.ok(source.includes("server.listen(port, '0.0.0.0'"));
  assert.ok(source.includes('serverUrl = `http://127.0.0.1:${port}`'));
});
