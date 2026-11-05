import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('P2: edição e duplicação de OS não descarregam clientes e veículos inteiros',()=>{
 const source=readFileSync('public/app-os-tools.js','utf8');
 const edit=source.slice(source.indexOf('async function editFullWorkOrder('),source.indexOf('async function showWorkOrderHistory('));
 const duplicate=source.slice(source.indexOf('async function duplicateWorkOrderUi('));
 for(const segment of [edit,duplicate]){
   assert.doesNotMatch(segment,/api\('\/api\/customers(?:\?includeInactive=1)?'\)/);
   assert.doesNotMatch(segment,/api\('\/api\/machines(?:\?includeInactive=1)?'\)/);
   assert.match(segment,/attachPagedLookup\(/);
 }
 assert.match(edit,/customerId/);
 assert.match(duplicate,/machineId/);
});
