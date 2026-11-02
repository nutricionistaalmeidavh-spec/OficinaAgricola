import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');

test('P0 UI: only one dashboard renderer exists across scripts',()=>{
 const paths=['public/app-core.js','public/app-stage7.js','public/app-orders.js'];
 const declarations=paths.reduce((total,path)=>total+[...read(path).matchAll(/(?:async\s+)?function\s+renderDashboard\s*\(/g)].length,0);
 assert.equal(declarations,1);
});

test('P0 UI: changing checklist templates cannot replay a stale response',()=>{
 const orders=read('public/app-orders.js');
 assert.match(orders,/checklistRequestVersion/);
 assert.match(orders,/version\s*!==\s*checklistRequestVersion/);
 assert.doesNotMatch(orders,/host\.innerHTML\s*=/);
});

test('P0 UI: browser projection uses keyed insertions and coalesces same-page refreshes',()=>{
 const core=read('public/app-core.js');
 assert.match(core,/reconcileChildren\(/);
 assert.match(core,/host\.insertBefore\(desired\.cloneNode\(true\),present\)/);
 assert.match(core,/refreshPromise/);
 assert.match(core,/renderRegion\(/);
});

test('P0 UI: same-origin shell scripts prefer network over stale service-worker cache',()=>{
 const sw=read('public/sw.js');
 assert.match(sw,/networkFirstStatic/);
 assert.match(sw,/\.(?:js|css)/);
 assert.doesNotMatch(sw,/cacheFirstStatic\(request\)/);
});
