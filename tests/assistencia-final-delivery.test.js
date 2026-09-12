import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');

test('entregas 11-14 deixam EventBus integrado e release final controlado', () => {
  assert.equal(existsSync('apps/assistencia-tecnica/src/platform/event-runtime.js'), true);
  assert.equal(existsSync('apps/assistencia-tecnica/src/platform/http-event-bridge.js'), true);
  assert.equal(existsSync('apps/assistencia-tecnica/tests/event-integration.test.js'), true);

  const events = read('apps/assistencia-tecnica/src/platform/events.js');
  const server = read('apps/assistencia-tecnica/src/server-assistencia.js');
  const start = read('apps/assistencia-tecnica/src/start.js');
  const pkg = JSON.parse(read('apps/assistencia-tecnica/package.json'));
  const circle = read('.circleci/config.yml');
  const readme = read('apps/assistencia-tecnica/README.md');

  for (const type of ['SALE_COMPLETED', 'SALE_CANCELLED', 'CASH_OPENED', 'CASH_CLOSED']) {
    assert.match(events, new RegExp(type));
  }
  assert.match(server, /attachHttpEventBridge/);
  assert.match(server, /eventRuntime/);
  assert.match(start, /createEventRuntime/);
  assert.equal(pkg.version, '1.0.0');

  assert.match(circle, /release\/assistencia-v1\.0\.0/);
  assert.match(circle, /assistencia_windows_build/);
  assert.match(circle, /AssistenciaTecnica-ArtiSys-Setup-/);
  assert.match(readme, /Entrega 11/);
  assert.match(readme, /Entrega 12/);
  assert.match(readme, /Entrega 13/);
  assert.match(readme, /Entrega 14/);
});
