import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');

test('Electron da assistência usa dados próprios e expõe LAN na porta 3344', () => {
  const argvGuard = source.indexOf("if (!process.argv[1]) process.argv[1] = fileURLToPath(import.meta.url)");
  const serverImport = source.indexOf("import('../dist/src/server-assistencia.js')");
  assert.ok(argvGuard >= 0, 'Electron deve normalizar process.argv[1] no build empacotado');
  assert.ok(serverImport > argvGuard, 'server-assistencia.js deve ser importado somente após normalizar process.argv[1]');
  assert.match(source, /AssistenciaTecnica/);
  assert.match(source, /assistencia-tecnica\.sqlite/);
  assert.match(source, /process\\.env\\.HOST\\s*=\\s*'0\\.0\\.0\\.0'/);
  assert.match(source, /process\\.env\\.PORT\\s*=\\s*'3344'/);
  assert.match(source, /migrate\(db\);/);
  assert.match(source, /migrateAssistencia\(db\);/);
  assert.match(source, /server\.listen\(port, '0\.0\.0\.0'/);
  assert.match(source, /serverUrl = `http:\/\/127\.0\.0\.1:\$\{port\}`/);
});
