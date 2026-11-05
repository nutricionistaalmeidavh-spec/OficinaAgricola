import {danfseTestLogo} from './fixtures/nfse-logo-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNationalNfseClient} from '../src/platform/nfse-national-api.js';
import {createNationalNfseProvider} from '../src/platform/nfse-national-provider.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const key='31062002211222333000181000000000012326111234567890';
const store={identity:()=> 'opaque-test-cert-identity',withTlsIdentity:async(_issuer,fn)=>fn({pfx:Buffer.from('only-local'),passphrase:'only-local'})};
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

test('DANFSe de nota autorizada é gerado offline sem requisitar PDF à API suspensa',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nfse-danfse-offline-'));
 const issuer={cnpj:'11222333000181',environment:'HOMOLOGACAO'};
 const xml='<NFSe><infNFSe Id="NFS'+key+'"><nNFSe>123</nNFSe>'+
  '<DPS><infDPS><tpAmb>2</tpAmb><serie>1</serie><nDPS>25</nDPS>'+
  '<prest><CNPJ>'+issuer.cnpj+'</CNPJ><xNome>Prestador Teste</xNome></prest>'+
  '<toma><CPF>12345678909</CPF><xNome>Cliente Teste</xNome></toma>'+
  '<serv><cServ><xDescServ>Serviço local</xDescServ></cServ></serv>'+
  '</infDPS></DPS></infNFSe></NFSe>';
 try{
   const provider=createNationalNfseProvider({
     certificateStore:store,inputDir:join(dir,'entrada'),danfseLogoPng:danfseTestLogo,
     client:{downloadDanfse:async()=>{throw Error('API DANFSe suspensa não deve ser chamada')}}
   });
   assert.equal(provider.certificateIdentity(),'opaque-test-cert-identity');
   const document={kind:'NFSE',status:'AUTORIZADA_HOMOLOGACAO',access_key:key,
      environment:'HOMOLOGACAO',authorized_xml:xml,issuer_snapshot_json:JSON.stringify(issuer)};
   const pdf=await provider.printPdf({document});
   assert.match(pdf.toString('latin1'),/^%PDF-/);
   assert.match(pdf.toString('latin1'),/DANFSe v2\.0/);
   await assert.rejects(provider.printPdf({document:{...document,status:'REJEITADA'}}),/autorizad|DANFSe/i);
   await assert.rejects(provider.printPdf({document:{...document,authorized_xml:''}}),/XML autorizado/i);
   await assert.rejects(provider.printPdf({document:{...document,issuer_snapshot_json:JSON.stringify({...issuer,cnpj:'99888777000122'})}}),/CNPJ|prestador/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
