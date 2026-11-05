import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNationalCancelRequest} from '../src/platform/nfse-national-cancellation.js';
import {nationalCancellationReceipt} from '../src/platform/nfse-national-event-receipt.js';
import {createNationalNfseClient} from '../src/platform/nfse-national-api.js';
import {gzipSync} from 'node:zlib';
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

test('só aceita evento 101101 da mesma chave, CNPJ e ambiente',async()=>{
 const eventId='EVT'+key+'101101001';
 const xml='<evento><infEvento Id="'+eventId+'"><tpAmb>2</tpAmb>'+
  '<chNFSe>'+key+'</chNFSe><CNPJAutor>'+issuer.cnpj+'</CNPJAutor>'+
  '<e101101><xDesc>Cancelamento de NFS-e</xDesc></e101101>'+
  '</infEvento></evento>';
 assert.equal(nationalCancellationReceipt(xml,key,issuer)?.eventId,eventId);
 assert.equal(nationalCancellationReceipt(xml,key,{...issuer,cnpj:'99888777000122'}),null);
 assert.equal(nationalCancellationReceipt(xml,key,{...issuer,environment:'PRODUCAO'}),null);
 const client=createNationalNfseClient({
  certificateStore:{withTlsIdentity:async(_opts,fn)=>fn({pfx:'simulado'})},
  transport:async({method,url})=>{
    assert.equal(method,'GET');
    assert.match(url,/\/eventos\/101101\/1$/);
    return {status:200,body:{tipoAmbiente:2,
      eventoXmlGZipB64:gzipSync(xml).toString('base64')}};
  }
 });
 const result=await client.queryCancellation({issuer,accessKey:key});
 assert.equal(result.status,'CANCELADA');
 assert.equal(result.accessKey,key);
 const other=await client.queryCancellation({issuer:{...issuer,environment:'PRODUCAO'},accessKey:key});
 assert.equal(other.status,'INDETERMINADO');
});
