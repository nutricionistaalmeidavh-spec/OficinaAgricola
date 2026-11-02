import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveDatabasePath } from '../src/platform/data-location.js';

test('seleciona banco antigo automaticamente apenas quando ele é a única fonte',()=>{
  const cwd='/app';
  const result=resolveDatabasePath({cwd,env:{},exists:path=>path===join(cwd,'data','oficina.sqlite')});
  assert.equal(result,join(cwd,'data','oficina.sqlite'));
});
test('não escolhe silenciosamente entre dois bancos com clientes diferentes',()=>{
  const cwd='/app';
  const files=new Set([join(cwd,'data','oficina.sqlite'),join(cwd,'apps','assistencia-tecnica','data','assistencia-tecnica.sqlite')]);
  assert.throws(()=>resolveDatabasePath({cwd,env:{},exists:files.has.bind(files)}),/DATABASE_PATH/);
});
test('DATABASE_PATH explícito preserva a preferência do operador',()=>{
  const result=resolveDatabasePath({cwd:'/app',env:{DATABASE_PATH:'custom/arquivo.sqlite'},exists:()=>false});
  assert.equal(result,'/app/custom/arquivo.sqlite');
});
test('instalação nova seleciona um único banco canônico',()=>{
  const result=resolveDatabasePath({cwd:'/app',env:{},exists:()=>false});
  assert.equal(result,'/app/data/artisys-oficina.sqlite');
});
