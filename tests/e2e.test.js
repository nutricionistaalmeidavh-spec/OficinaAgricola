import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('shell PWA está preparado para uso local em tablet/celular', () => {
  const index = readFileSync('public/index.html', 'utf8');
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(index, /manifest\.webmanifest/);
  assert.match(index, /pwa-register\.js/);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.start_url);
  assert.match(sw, /\/api\//);
  assert.match(sw, /network/i);
});
