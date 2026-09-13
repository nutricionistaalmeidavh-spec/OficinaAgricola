import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('Lote A agricultural workshop theme is wired into the local-first shell', () => {
  const html = read('../public/index.html');
  const sw = read('../public/sw.js');
  const themePath = new URL('../public/theme-lote-a.css', import.meta.url);
  assert.equal(fs.existsSync(themePath), true);
  const theme = fs.readFileSync(themePath, 'utf8');
  assert.match(theme, /--green:#365314/);
  assert.match(theme, /--accent:#b45309/);
  assert.match(html, /theme-lote-a\.css/);
  assert.match(sw, /theme-lote-a\.css/);
});
