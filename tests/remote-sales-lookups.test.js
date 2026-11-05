import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('P2: venda de balcão pesquisa clientes e peças paginadas sem carregar tabela inteira',()=>{
 const s=readFileSync('public/app-assistencia.js','utf8');
 const start=s.indexOf('async function saleModal()');
 const end=s.indexOf('async function saleDetails(',start);
 const sale=s.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.doesNotMatch(sale,/api\('\/api\/parts'\)/);
 assert.doesNotMatch(sale,/api\('\/api\/customers'\)/);
 assert.match(sale,/\/api\/parts\/page/);
 assert.match(sale,/attachPagedLookup/);
 assert.match(sale,/data-sale-part/);
 assert.match(sale,/data-sale-service/);
 assert.match(sale,/data-sale-kind/);
});
