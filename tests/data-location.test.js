import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { resolveDatabasePath, resolveStoragePath } from '../src/platform/data-location.js';

test('cria instalação nova sem detectar bases legadas',()=>{
  const cwd='/app';
  const found=new Set([join(cwd,'data','oficina.sqlite'),join(cwd,'data','assistencia-tecnica.sqlite')]);
  assert.equal(resolveDatabasePath({cwd,env:{},exists:p=>found.has(p)}),resolve(cwd,'data','artisys-oficina.sqlite'));
});
test('bases antigas não bloqueiam a inicialização do novo produto',()=>{
  assert.doesNotThrow(()=>resolveDatabasePath({cwd:'/app',env:{},exists:()=>true}));
  assert.equal(resolveDatabasePath({cwd:'/app',env:{},exists:()=>true}),resolve('/app','data','artisys-oficina.sqlite'));
});
test('DATABASE_PATH explícito continua disponível para QA e administradores',()=>{
  assert.equal(resolveDatabasePath({cwd:'/app',env:{DATABASE_PATH:'custom/arquivo.sqlite'}}),resolve('/app','custom','arquivo.sqlite'));
});
test('anexos novos usam storage/uploads exclusivo sem detectar legados',()=>{
  const cwd='/app',databasePath=resolve(cwd,'data','artisys-oficina.sqlite');
  assert.equal(resolveStoragePath({cwd,env:{},databasePath,exists:()=>true}),resolve(cwd,'storage','uploads'));
});
test('instalação nova não requer banco já existente',()=>{
  assert.equal(resolveDatabasePath({cwd:'/app',env:{}}),resolve('/app','data','artisys-oficina.sqlite'));
});
