import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('P0: quadro inclui encerradas e reprovadas',()=>{const src=read('public/app-orders.js');for(const status of ['ENTREGUE','CANCELADA','REPROVADA'])assert.match(src,new RegExp("\\['"+status+"','"));});
test('P0: fechamento de caixa exige contagem manual',()=>{const src=read('public/app-assistencia.js');assert.match(src,/placeholder="Informe o valor contado"/);assert.doesNotMatch(src,/name="closing"[^>]*value=/);});
test('P0: estoque crítico completo',()=>assert.doesNotMatch(read('src/services/dashboard.js'),/lowStockParts\\(db\\)\\.slice/));
test('P0: indicadores diferenciam fluxo atual e entregas mensais',()=>{const src=read('public/app-stage7.js');assert.match(src,/monthStart/);assert.match(src,/OS em fluxo \\(atual\\)/);});
test('P0: botões de cadastro respeitam perfil',()=>{const src=read('public/app-catalog.js');assert.match(src,/\['ADMIN','ATENDIMENTO'\]\.includes\(state\.user\.role\)/);});
