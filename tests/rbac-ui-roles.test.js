import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function policy(){
 const window={};
 runInNewContext(readFileSync('public/role-permissions.js','utf8'),{window});
 return window.OficinaRolePermissions;
}

test('admin is authorized to navigate every exposed Oficina page',()=>{
 const can=policy().canViewPage;
 for(const page of ['dashboard','work-orders','schedule','customers','market',
  'machines','services','inventory','sales','finance','reports',
  'technicians','settings'])
  assert.equal(can('ADMIN',page),true,page);
});

test('staff sees only the modules permitted by role, and unknown routes fail closed',()=>{
 const can=policy().canViewPage;
 for(const role of ['ATENDIMENTO','TECNICO']){
  assert.equal(can(role,'finance'),false);
  assert.equal(can(role,'fiscal'),false);
  assert.equal(can(role,'settings'),false);
 }
 assert.equal(can('TECNICO','sales'),false);
 assert.equal(can('TECNICO','work-orders'),true);
 assert.equal(can('TECNICO','schedule'),true);
 assert.equal(can('ATENDIMENTO','sales'),true);
 assert.equal(can('FINANCEIRO','finance'),true);
 assert.equal(can('FINANCEIRO','fiscal'),false);
 assert.equal(can('ADMIN','fiscal'),false);
 assert.equal(can('FINANCEIRO','settings'),false);
 for(const role of ['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO'])
  assert.equal(can(role,'undefined-module'),false);
});

test('browser loads the role policy before app-core and protects deep navigation',()=>{
 const html=readFileSync('public/index.html','utf8');
 assert.ok(html.indexOf('/role-permissions.js')>=0);
 assert.ok(html.indexOf('/role-permissions.js')<html.indexOf('/app-core.js'));
 const core=readFileSync('public/app-core.js','utf8');
 assert.match(core,/if\(!canViewModule\(page\)\)/);
 assert.match(core,/data-mobile-page/);
});

test('the OS modal skips payment ledger reads for non-finance employees',()=>{
 const source=readFileSync('public/app-orders.js','utf8');
 assert.match(source,/canFinance\?api\(\x60\/api\/work-orders\/\$\{id\}\/payment\x60\):Promise\.resolve\(null\)/);
 assert.match(source,/canFinance\?api\(\x60\/api\/work-orders\/\$\{id\}\/receipts\x60\):Promise\.resolve\(\[\]\)/);
 assert.match(source,/\$\{canFinance\?\x60\s*<div class="detail-block(?: os-finance)?"><h3>(?:Financeiro|Recebimento)/);
});
