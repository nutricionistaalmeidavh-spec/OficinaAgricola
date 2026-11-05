import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createNationalNfseClient,nationalNfseEndpoint,buildNationalDpsId} from '../src/platform/nfse-national-api.js';

const issuer={cnpj:'11222333000181',municipalityIbge:'3106200',environment:'HOMOLOGACAO'};
const idDps=buildNationalDpsId({municipalityIbge:'3106200',cnpj:issuer.cnpj,series:'1',number:'25'});
const key='3106200'+'2'+'2'+issuer.cnpj+'0000000000123'+'2611'+'123456789'+'0';
const signedXml='<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="'+idDps+'"><prest><CNPJ>'+issuer.cnpj+'</CNPJ></prest></infDPS><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></DPS>';
const xml='<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS'+key+'"><nNFSe>123</nNFSe><DPS><infDPS Id="'+idDps+'"><serie>1</serie><prest><CNPJ>'+issuer.cnpj+'</CNPJ></prest></infDPS></DPS></infNFSe></NFSe>';
const store={withTlsIdentity:async(_issuer,action)=>action({pfx:Buffer.from('private-pfx'),passphrase:'local-only'})};
const gzip=value=>gzipSync(value).toString('base64');
test('endereços da SEFIN são oficiais e imutáveis entre homologação e produção',()=>{
 assert.equal(nationalNfseEndpoint('HOMOLOGACAO'), 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional');
 assert.equal(nationalNfseEndpoint('PRODUCAO'), 'https://sefin.nfse.gov.br/SefinNacional');
 assert.throws(()=>nationalNfseEndpoint('TESTE'),/ambiente/i);
 assert.equal(idDps.length,45);
});
test('envio usa apenas certificado A1 local, GZIP/Base64 e reconhece retorno oficial completo',async()=>{
 const calls=[];
 const api=createNationalNfseClient({certificateStore:store,transport:async req=>{
  calls.push(req);
  return {status:201,body:{tipoAmbiente:2,idDps,chaveAcesso:key,nfseXmlGZipB64:gzip(xml)}};
 }});
 const result=await api.issue({issuer,idDps,signedDpsXml:signedXml});
 assert.equal(result.status,'AUTORIZADA');
 assert.equal(result.number,'123');
 assert.equal(result.accessKey,key);
 assert.equal(result.environment,'HOMOLOGACAO');
 assert.match(result.xml,/infNFSe/);
 assert.equal(calls[0].url,'https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse');
 assert.equal(calls[0].method,'POST');
 assert.equal(JSON.parse(calls[0].body).dpsXmlGZipB64,gzip(signedXml));
 assert.equal(calls[0].identity.passphrase,'local-only');
});
test('envio falha fechado se XML não está assinado, vínculo não confere ou ambiente diverge',async()=>{
 let requests=0;
 const api=createNationalNfseClient({certificateStore:store,transport:async()=>{requests++;return {status:201,body:{tipoAmbiente:1,idDps,chaveAcesso:key,nfseXmlGZipB64:gzip(xml)}};}});
 await assert.rejects(api.issue({issuer,idDps,signedDpsXml:signedXml.replace('Signature','NotSigned')}),/assinad|Signature/);
 await assert.rejects(api.issue({issuer,idDps:'DPS123',signedDpsXml:signedXml}),/DPS|identificador/);
 const result=await api.issue({issuer,idDps,signedDpsXml:signedXml});
 assert.equal(result.status,'INDETERMINADO');
 assert.equal(requests,1);
});
test('recuperação consulta primeiro DPS e depois NFSe sem reenviar o XML',async()=>{
 const calls=[];
 const api=createNationalNfseClient({certificateStore:store,transport:async req=>{
  calls.push(req.method+' '+new URL(req.url).pathname);
  return calls.length===1?{status:200,body:{chaveAcesso:key}}
   :{status:200,body:{tipoAmbiente:2,chaveAcesso:key,nfseXmlGZipB64:gzip(xml)}};
 }});
 const result=await api.reconcile({issuer,idDps});
 assert.equal(result.status,'AUTORIZADA');
 assert.deepEqual(calls,['GET /SefinNacional/dps/'+idDps,'GET /SefinNacional/nfse/'+key]);
});
test('rejeição explícita não vira autorização, erro de rede exige conciliação',async()=>{
 const api=createNationalNfseClient({certificateStore:store,transport:async()=>({status:400,body:{erros:[{Codigo:'E0001',Descricao:'DPS inválida'}]}})});
 const result=await api.issue({issuer,idDps,signedDpsXml:signedXml});
 assert.equal(result.status,'REJEITADA');
 const bad=createNationalNfseClient({certificateStore:store,transport:async()=>{throw Error('network timeout')}});
 await assert.rejects(bad.issue({issuer,idDps,signedDpsXml:signedXml}),/network timeout/);
});
test('evento exige XML assinado; nenhuma chamada de cancelamento é inferida como concluída',async()=>{
 let count=0;
 const api=createNationalNfseClient({certificateStore:store,transport:async req=>{
  count++;assert.match(req.url,/\/nfse\/[0-9]{50}\/eventos$/);
  assert.equal(JSON.parse(req.body).pedidoRegistroEventoXmlGZipB64,gzip('<pedRegEvento><Signature>abc</Signature></pedRegEvento>'));
  return {status:201,body:{tipoAmbiente:2,eventoXmlGZipB64:gzip('<evento/>')}};
 }});
 const answer=await api.registerEvent({issuer,accessKey:key,signedEventXml:'<pedRegEvento><Signature>abc</Signature></pedRegEvento>'});
 assert.equal(answer.status,'EVENTO_RECEBIDO_PENDENTE_CONFIRMACAO');
 assert.equal(count,1);
});
