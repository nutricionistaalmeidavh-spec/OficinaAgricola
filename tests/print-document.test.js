import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('P1 impressão de OS e documentos usa ação explícita, com layout A4',()=>{
 const template=readFileSync('src/documents.js','utf8');
 const orders=readFileSync('public/app-orders.js','utf8');
 assert.match(template,/@page\s*\{\s*size:\s*A4;/);
 assert.match(template,/@media print/);
 assert.match(orders,/data-print=/);
 assert.match(orders,/function printWorkOrderDocument/);
 assert.match(orders,/\.print\(\)/);
});

test('P1: seletores de documentos e impressão são coleções; abertura da OS não interrompe ações',()=>{
 const orders=readFileSync('public/app-orders.js','utf8');
 assert.ok(orders.includes("$$('[data-doc]').forEach"),'Botões dos documentos precisam de querySelectorAll');
 assert.ok(orders.includes("$$('[data-print]').forEach"),'Botões de impressão precisam de querySelectorAll');
});
