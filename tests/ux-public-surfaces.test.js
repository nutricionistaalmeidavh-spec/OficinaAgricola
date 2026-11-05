import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicErrorMessage} from '../src/platform/public-errors.js';

const read=path=>readFileSync(path,'utf8');

test('respostas públicas não revelam mensagens de infraestrutura',()=>{
  for(const message of [
    'SQLITE_CONSTRAINT: UNIQUE constraint failed: users.password',
    'TypeError: Cannot read properties of undefined',
    'ENOENT: no such file or directory, open /srv/private/config.json',
    'Error: token=segredo\n    at run (file:///srv/server.js:10:3)',
  ]){
    const output=publicErrorMessage(new Error(message));
    assert.doesNotMatch(output,/SQLITE|TypeError|ENOENT|\/srv\/|token=|at run/i);
    assert.match(output,/Não foi possível/);
  }
  assert.equal(publicErrorMessage(new Error('Cliente não encontrado')),'Cliente não encontrado');
  for(const message of ['Placa inválida','RENAVAM inválido','Prioridade inválida','Muitas tentativas'])
    assert.equal(publicErrorMessage(new Error(message)),message);
});

test('APIs da oficina e assistência usam sanitização pública sem alterar status HTTP',()=>{
  assert.match(read('src/server.js'),/publicErrorMessage\(error\)/);
  assert.match(read('src/server-assistencia.js'),/publicErrorMessage\(error\)/);
});

test('campos de vínculo à OS são seletores por número comercial, não IDs digitados',()=>{
  const catalog=read('public/app-catalog.js');
  const diagnostic=read('public/obd-diagnostics.js');
  assert.doesNotMatch(catalog,/<input[^>]*name="workOrderId"[^>]*type="number"/);
  assert.doesNotMatch(catalog,/<input[^>]*id="obdWorkOrder"[^>]*type="number"/);
  assert.doesNotMatch(diagnostic,/<input[^>]*id="diagOs"[^>]*type="number"/);
  assert.match(catalog,/workOrderSelector/);
  assert.match(diagnostic,/workOrderSelector/);
});

test('fiscal identifica documento pelo número autorizado ou vínculo comercial',()=>{
  const fiscal=read('public/app-fiscal.js');
  assert.match(fiscal,/fiscalDisplayTitle/);
  assert.doesNotMatch(fiscal,/esc\(d\.kind\)\+' #'\+d\.id/);
  assert.doesNotMatch(fiscal,/\+origin\+' #'\+d\.origin_id/);
});

test('kanban operacional pagina por status e trata coluna vazia',()=>{
  const orders=read('public/app-orders.js');
  assert.match(orders,/data-os-more/);
  assert.match(orders,/\$\$\('\[data-os-more\]'\)\.forEach/);
  assert.match(orders,/status='\+encodeURIComponent\(status\)/);
  assert.match(orders,/Nenhuma OS nesta etapa/);
  assert.match(orders,/Carregando OS/);
  assert.match(orders,/Tentar novamente/);
  const dashboard=read('public/app-stage7.js');
  assert.match(dashboard,/outras OS/);
});

test('simulador fica fora da seleção comum, e mensagens técnicas ficam recolhidas',()=>{
  const diagnostic=read('public/obd-diagnostics.js');
  assert.match(diagnostic,/registry\.filter\(adapter=>adapter\.id!=='SIMULATOR'\)/);
  assert.match(diagnostic,/<details/);
});

test('perfis operacionais usam nomes legíveis no painel e na administração',()=>{
  const core=read('public/app-core.js'),admin=read('public/app-admin.js');
  assert.match(core,/userRoleLabel/);
  assert.match(admin,/badge\(userRoleLabel\((?:u|user)\.role\)\)/);
  assert.match(admin,/<option value="TECNICO">Técnico<\/option>/);
});

test('QA visual compara rótulos de perfis, não códigos internos',()=>{
  const qa=read('scripts/qa-cliente-os.mjs');
  assert.match(qa,/actualRole !== expectedRole/);
  assert.match(qa,/ATENDIMENTO:'Atendimento'/);
});
