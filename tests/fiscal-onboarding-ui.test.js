import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('fiscal form no longer requires manual feature activation',()=>{
 const ui=readFileSync(new URL('../public/app-fiscal.js',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/name="enabled"/);
 assert.doesNotMatch(ui,/enabled:o\.enabled==='on'/);
 assert.match(ui,/Cadastro fiscal/);
});

test('formulário tributário expõe redução e diferimento explícitos sem alíquotas padrão',()=>{
 const ui=readFileSync(new URL('../public/app-fiscal.js',import.meta.url),'utf8');
 assert.match(ui,/IbsReduction/);
 assert.match(ui,/IbsDeferral/);
 assert.match(ui,/IbsCst/);
 assert.match(ui,/IbsClass/);
 assert.match(ui,/item.*Profile/);
});
