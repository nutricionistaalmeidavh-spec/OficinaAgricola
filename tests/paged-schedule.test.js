import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('P2 agenda pesquisa clientes e OS por cursor e não carrega os catálogos integralmente',()=>{
 const s=readFileSync('public/app-operations.js','utf8');
 const start=s.indexOf('async function renderSchedule('),end=s.indexOf('async function renderFinance(',start);
 const schedule=s.slice(start,end);
 assert.doesNotMatch(schedule,/api\('\/api\/customers'\)/);
 assert.doesNotMatch(schedule,/api\('\/api\/machines'\)/);
 assert.doesNotMatch(schedule,/api\('\/api\/work-orders'\)/);
 assert.match(schedule,/attachPagedLookup\(/);
 assert.match(schedule,/resource:'work-orders'/);
});
