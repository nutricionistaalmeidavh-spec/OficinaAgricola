import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('P0: quadro contém estados encerrados',()=>{const src=read('public/app-orders.js');for(const status of ['ENTREGUE','CANCELADA','REPROVADA'])assert.ok(src.includes("'"+status+"'"),status);assert.ok(src.includes('osArchiveStatus'));assert.ok(src.includes('osArchiveMore'));});
test('P0: fechamento de caixa exige contagem manual',()=>{const src=read('public/app-assistencia.js');assert.ok(src.includes('placeholder="Informe o valor contado"'));assert.ok(!src.includes('name="closing" type="number" min="0" step="0.01" value='));});
test('P0: estoque crítico não é truncado no serviço',()=>assert.ok(!read('src/services/dashboard.js').includes('lowStockParts(db).slice(')));
test('P0: relatório identifica métricas mensais e atuais',()=>{const src=read('public/app-stage7.js');assert.ok(src.includes('dashboard.counts.ENTREGUES_MES'));assert.ok(src.includes('dashboard.counts.ABERTAS'));assert.ok(src.includes('OS em fluxo (atual)'));});
test('P0: criação de cadastros depende de papel',()=>assert.ok(read('public/app-catalog.js').includes("['ADMIN','ATENDIMENTO'].includes(state.user.role)")));
