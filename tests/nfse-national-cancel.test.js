import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNationalCancelRequest} from '../src/platform/nfse-national-cancellation.js';
const key='31062002211222333000181000000000012326111234567890';
const issuer={cnpj:'11222333000181',environment:'HOMOLOGACAO'};
test('cancelamento nacional usa PRE, motivo explícito, chave e autor corretos',()=>{
 const value=buildNationalCancelRequest({issuer,accessKey:key,
  reason:'Serviço não foi prestado por desistência do contratante',
  at:new Date('2026-11-05T15:00:00.000Z')});
 assert.equal(value.id,'PRE'+key+'101101');
 assert.match(value.xml,/<pedRegEvento/);
 assert.match(value.xml,/<tpAmb>2<\/tpAmb>/);
 assert.match(value.xml,/<CNPJAutor>11222333000181<\/CNPJAutor>/);
 assert.match(value.xml,/<chNFSe>/);
 assert.match(value.xml,/<e101101>/);
 assert.match(value.xml,/<cMotivo>9<\/cMotivo>/);
});
test('cancelamento rejeita chave, ambiente e justificativa inválidos',()=>{
 const request={issuer,accessKey:key,reason:'Justificativa de cancelamento fiscal'};
 for(const change of [{accessKey:'1'},{issuer:{...issuer,environment:'INVALIDO'}},
  {reason:'curto'},{reason:'a'.repeat(256)},{reason:'Linha\nquebrada suficiente'}])
  assert.throws(()=>buildNationalCancelRequest({...request,...change}));
});
