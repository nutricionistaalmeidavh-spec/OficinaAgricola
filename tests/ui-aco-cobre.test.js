import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const html=file('index.html');
const manifest=JSON.parse(file('manifest.webmanifest'));
const theme=file('ui-aco-cobre.css');
const orders=file('app-orders.js');
const journey=file('app-journey.js');

test('Aço & Cobre: tema claro é carregado após as folhas anteriores',()=>{
  assert.match(html, /href="\/ui-aco-cobre\.css"/);
  assert.ok(html.lastIndexOf('ui-aco-cobre.css') > html.lastIndexOf('barcode-scanner.css'));
  assert.match(html, /name="theme-color" content="#235A75"/);
  assert.equal(manifest.theme_color,'#235A75');
  assert.equal(manifest.background_color,'#F7F9FC');
});

test('Aço & Cobre: contraste de superfícies, design tokens e foco de teclado',()=>{
  for(const color of ['#235A75','#A7511B','#F7F9FC','#EAF1F6','#172A3A','#D7E1E8'])
    assert.ok(theme.includes(color), `Cor do tema ausente: ${color}`);
  assert.match(theme,/--green:\s*#235A75/);
  assert.match(theme,/:focus-visible/);
  assert.match(theme,/prefers-reduced-motion/);
  assert.match(theme,/@media\s*\(max-width:\s*840px\)/);
});

test('Kanban permite movimento apenas via transição permitida no backend',()=>{
  assert.match(orders,/ondragstart/);
  assert.match(orders,/ondrop/);
  assert.match(orders,/availableTransitions/);
  assert.match(orders,/changeWorkOrderStatus\(/);
  assert.match(orders,/\['ADMIN','ATENDIMENTO','TECNICO'\]/);
  assert.match(journey,/expectedVersion:os\.version/);
  assert.match(journey,/\/status`/);
});

test('Kanban permanece operável sem arrastar por meio do detalhe acessível da OS',()=>{
  assert.match(orders,/type="button" class="os-card"/);
  assert.match(orders,/openWorkOrder\(card\.dataset\.os\)/);
  assert.match(orders,/kanban-help/);
});
