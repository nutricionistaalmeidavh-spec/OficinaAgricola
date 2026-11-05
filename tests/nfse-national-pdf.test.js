import test from 'node:test';
import assert from 'node:assert/strict';
import {createNationalNfseClient} from '../src/platform/nfse-national-api.js';
const key='31062002211222333000181000000000012326111234567890';
const store={withTlsIdentity:async(_issuer,fn)=>fn({pfx:Buffer.from('only-local'),passphrase:'only-local'})};
test('DANFSe é recuperado apenas pelo ADN oficial com chave autorizada e mTLS A1',async()=>{
 const urls=[];
 const c=createNationalNfseClient({certificateStore:store,
  pdfTransport:async({url,identity})=>{urls.push(url);assert.equal(identity.passphrase,'only-local');
   return {status:200,body:Buffer.from('%PDF-1.7\\n teste fim')};}});
 const result=await c.downloadDanfse({issuer:{cnpj:'11222333000181',environment:'HOMOLOGACAO'},accessKey:key});
 assert.match(result.toString(),/^%PDF-/);
 assert.deepEqual(urls,['https://adn.producaorestrita.nfse.gov.br/danfse/'+key]);
});
test('não aceita HTML, PDF de origem desconhecida nem retorno não autorizado',async()=>{
 const issuer={cnpj:'11222333000181',environment:'PRODUCAO'};
 const bad=createNationalNfseClient({certificateStore:store,pdfTransport:async()=>({status:200,body:Buffer.from('<html>erro</html>')})});
 await assert.rejects(bad.downloadDanfse({issuer,accessKey:key}),/PDF|DANFSe/i);
 const missing=createNationalNfseClient({certificateStore:store,pdfTransport:async()=>({status:404,body:Buffer.from('')})});
 await assert.rejects(missing.downloadDanfse({issuer,accessKey:key}),/DANFSe/i);
 await assert.rejects(bad.downloadDanfse({issuer,accessKey:'nada'}),/chave|Chave/i);
});
