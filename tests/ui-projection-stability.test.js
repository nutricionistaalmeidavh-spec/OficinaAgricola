import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('após salvar os módulos pedem atualização pontual e não recriam a página inteira',()=>{
 const modules=[
  'public/app-assistencia.js','public/app-catalog.js','public/app-orders.js',
  'public/app-os-tools.js','public/app-operations.js','public/app-admin.js'
 ];
 for(const path of modules){
   const src=readFileSync(path,'utf8');
   assert.doesNotMatch(src,/await\s+render(?:Customers|Machines|WorkOrders|Inventory|Schedule|Finance|Services|Sales|Technicians|Settings)\s*\(\s*\)/,
     `Re-render pós-save: ${path}`);
 }
 const core=readFileSync('public/app-core.js','utf8');
 assert.match(core,/async function refreshCurrentPage\(/);
 assert.match(core,/function reconcileChildren\(/);
 assert.match(core,/state\.pageReady/);
});

test('modal pode abrir conteúdo atualizado sem destruir formulário ou fechar modal sucessor',()=>{
 const core=readFileSync('public/app-core.js','utf8');
 assert.match(core,/state\.modalToken/);
 assert.match(core,/if\s*\(state\.modalToken===token\)/);
 assert.match(core,/reconcileChildren\(body/);
});
