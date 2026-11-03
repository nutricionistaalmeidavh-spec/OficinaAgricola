import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const read = async path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('P0: catalogo distribuido localmente possui 532 modelos unicos e metadados', async () => {
  const catalog = JSON.parse(await read('public/carros3d/catalog.json'));
  assert.equal(catalog.cars.length, 532);
  assert.equal(new Set(catalog.cars.map(v => v.id)).size, 532);
  assert.ok(catalog.cars.every(v => v.brand && v.model && v.file.endsWith('.glb')
    && v.credit?.author && v.credit?.license && v.credit?.sourceUrl));
  assert.ok(catalog.cars.some(v => v.id === 'fiat-uno'));
  assert.ok(catalog.cars.some(v => v.id === 'toyota-hilux'));
});

test('P0: busca offline filtra por marca, categoria e texto sem acentos', async () => {
  const window = {};
  runInNewContext(await read('public/model-library.js'), { window, globalThis: window });
  const lib = window.OficinaModelLibrary;
  assert.equal(typeof lib.render, 'function');
  assert.equal(typeof lib.filter, 'function');
  const data = [
    { id:'fiat-palio',brand:'Fiat',model:'Pálio',category:'hatchback' },
    { id:'toyota-hilux',brand:'Toyota',model:'Hilux',category:'pickup' },
    { id:'fiat-strada',brand:'Fiat',model:'Strada',category:'pickup' }
  ];
  assert.equal(lib.filter(data,{term:'palio'}).length,1);
  assert.equal(lib.filter(data,{brand:'Fiat',category:'pickup'}).length,1);
  assert.equal(lib.filter(data,{term:'nao existe'}).length,0);
  assert.equal(lib.filter(data,{term:'  HI LUX  '}).length,0);
  assert.equal(lib.formatBytes(1048576),'1,00 MB');
});

test('P0: tela está integrada à navegação desktop e mobile, sem baixar GLBs', async () => {
  const html = await read('public/index.html');
  const core = await read('public/app-core.js');
  const sw = await read('public/sw.js');
  const css = await read('public/model-library.css');
  assert.match(html,/data-page="model-library"/);
  assert.match(html,/data-mobile-page="model-library"/);
  assert.match(html,/src="\/model-library\.js"/);
  assert.match(html,/href="\/model-library\.css"/);
  assert.match(core,/['"]model-library['"]\s*:\s*[^,}]+/);
  assert.match(sw,/\/carros3d\/catalog\.json/);
  assert.match(sw,/\/model-library\.js/);
  assert.match(css,/@media/);
  const assets = await readdir(new URL('../public/carros3d/', import.meta.url));
  assert.ok(!assets.some(name=>name.endsWith('.glb')));
});
