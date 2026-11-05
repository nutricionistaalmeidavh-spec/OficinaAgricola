import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('fiscal form no longer requires manual feature activation',()=>{
 const ui=readFileSync(new URL('../public/app-fiscal.js',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/name=\\"enabled\\"/);
 assert.doesNotMatch(ui,/enabled:o\.enabled==='on'/);
 assert.match(ui,/Cadastro fiscal/);
});
