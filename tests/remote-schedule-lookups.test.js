import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('P2 - agenda usa pesquisa remota de clientes e OS em vez de download completo',()=>{
 const src=readFileSync('public/app-operations.js','utf8');
 const begin=src.indexOf('async function renderSchedule('),end=src.indexOf('async function renderFinance(',begin);
 const segment=src.slice(begin,end);
 assert.doesNotMatch(segment,/api\('\/api\/customers'\)/);
 assert.doesNotMatch(segment,/api\('\/api\/machines'\)/);
 assert.doesNotMatch(segment,/api\('\/api\/work-orders'\)/);
 assert.match(segment,/attachPagedLookup/);
});
test('P2 - busca de OS na agenda preserva limites e filtros',()=>{
 const source=readFileSync('public/paged-lookups.js','utf8');
 const context={URLSearchParams};
 runInNewContext(source+';globalThis.url=pagedLookupUrl;',context);
 const path=context.url('work-orders',{search:'12345',limit:30});
 assert.match(path,/^\/api\/work-orders\/page\?/);
 const url=new URL('http://localhost'+path);
 assert.equal(url.searchParams.get('search'),'12345');
 assert.equal(url.searchParams.get('limit'),'30');
});
