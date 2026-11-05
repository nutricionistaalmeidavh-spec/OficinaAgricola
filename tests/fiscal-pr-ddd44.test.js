import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const file=new URL('../public/pr-ddd44-municipios.js',import.meta.url);
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

function getCities(){
  const globals={};
  runInNewContext(readFileSync(file,'utf8'),{globalThis:globals});
  return globals.PR_DDD44_MUNICIPIOS;
}

test('DDD 44 tem 124 municípios paranaenses com IBGE canônico e sem ambiguidades',()=>{
  const cities=getCities();
  assert.equal(cities.length,124);
  assert.equal(new Set(cities.map(city=>city.ibge)).size,124);
  assert.equal(new Set(cities.map(city=>city.name)).size,124);
  for(const city of cities){
    assert.match(city.ibge,/^41\d{5}$/);
    assert.ok(city.name.trim());
  }
  assert.equal(cities.some(city=>city.name==='Sabáudia'),false,'Sabáudia usa DDD 43 desde 2013');
});

test('municípios-polo fiscal DDD 44 preservam geocódigos oficiais',()=>{
  const cities=getCities();
  const byName=Object.fromEntries(cities.map(city=>[city.name,city.ibge]));
  assert.equal(byName['Maringá'],'4115200');
  assert.equal(byName['Umuarama'],'4128104');
  assert.equal(byName['Paranavaí'],'4118402');
  assert.equal(byName['Campo Mourão'],'4104303');
  assert.equal(byName['Cianorte'],'4105508');
  assert.equal(byName['Sarandi'],'4126256');
  assert.equal(byName['Alto Paraíso'],'4128625');
});

test('catálogo é carregado antes da UI fiscal e não depende de serviços pagos',()=>{
  const catalog=html.indexOf('src="/pr-ddd44-municipios.js"');
  const fiscal=html.indexOf('src="/app-fiscal.js"');
  assert.ok(catalog!==-1&&fiscal>catalog,'catálogo deve existir antes do formulário fiscal');
  const fiscalSource=readFileSync(new URL('../public/app-fiscal.js',import.meta.url),'utf8');
  assert.match(fiscalSource,/PR_DDD44_MUNICIPIOS/);
  assert.ok(fiscalSource.includes("lookup.hidden=issuerUf.value!=='PR'"),'seletor deve aparecer somente quando a UF for PR');
});

test('tela fiscal usa seletores de coleção nos eventos, mesmo sem documentos',()=>{
 const source=readFileSync(new URL('../public/app-fiscal.js',import.meta.url),'utf8');
 for(const name of ['data-nfse-competence','data-fiscal-details','data-fiscal-origin']){
   const bind=source.split('\n').filter(line=>line.includes('['+name+']')&&line.includes('.forEach('));
   assert.ok(bind.length>0,'handler ausente: '+name);
   assert.ok(bind.every(line=>line.includes("$$('["+name+"]')")),
     'os handlers devem utilizar seletor de coleção: '+name);
 }
});
