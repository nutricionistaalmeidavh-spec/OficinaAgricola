import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync('public/paged-lookups.js','utf8');
const ctx={URLSearchParams};
runInNewContext(script+';globalThis.lookupUrl=pagedLookupUrl;',ctx);

test('P2 busca remota usa paginação limitada e preserva filtros',()=>{
 const url=ctx.lookupUrl('machines',{search:'Fiat Uno',customerId:123});
 assert.match(url,/^\/api\/machines\/page\?/);
 const parsed=new URL('http://local'+url);
 assert.equal(parsed.searchParams.get('search'),'Fiat Uno');
 assert.equal(parsed.searchParams.get('customerId'),'123');
 assert.equal(parsed.searchParams.get('limit'),'30');
});

test('P2 busca remota rejeita recurso arbitrário e IDs malformados',()=>{
 assert.throws(()=>ctx.lookupUrl('users',{search:'x'}),/recurso/i);
 assert.throws(()=>ctx.lookupUrl('machines',{customerId:'123&role=ADMIN'}),/cliente/i);
});

test('P2 criação de OS/equipamento não faz download integral de clientes e máquinas',()=>{
 const orders=readFileSync('public/app-orders.js','utf8');
 const catalog=readFileSync('public/app-catalog.js','utf8');
 assert.doesNotMatch(orders,/Promise\.all\(\[api\('\/api\/customers'\),api\('\/api\/machines'\)/);
 assert.doesNotMatch(catalog,/machineModal\(await api\('\/api\/customers'\)/);
 assert.match(orders,/attachPagedLookup/);
 assert.match(catalog,/attachPagedLookup/);
});
