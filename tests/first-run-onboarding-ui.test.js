import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('primeiro acesso tem tela e navegação explícita no app',()=>{
 const html=read('../public/index.html'),core=read('../public/app-core.js'),ui=read('../public/app-onboarding.js');
 assert.match(html,/src="\/app-onboarding\.js"/);
 assert.match(html,/data-page="onboarding"/);
 assert.match(core,/openInitialPage/);
 assert.match(core,/dashboard,onboarding,customers/);
 assert.match(ui,/Começar a trabalhar/);
 assert.match(ui,/api\/onboarding\/diagnostics/);
 assert.match(ui,/action:'finish'/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|autorizad[oa] para produ[çc][ãa]o/i);
});
