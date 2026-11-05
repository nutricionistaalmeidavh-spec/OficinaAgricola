import test from 'node:test';
import assert from 'node:assert/strict';
import {createNationalNfseClient} from '../src/platform/nfse-national-api.js';
import {createNationalNfseProvider} from '../src/platform/nfse-national-provider.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('PDF de NFS-e autorizada é acessível pelo provedor instalado no Oficina',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nfse-adn-pdf-'));
 const issuer={cnpj:'11222333000181',environment:'HOMOLOGACAO'};
 let count=0;
 try{
   const provider=createNationalNfseProvider({
     certificateStore:store,inputDir:join(dir,'entrada'),
     client:{downloadDanfse:async input=>{
       count++;
       assert.deepEqual(input,{issuer,accessKey:key});
       return Buffer.from('%PDF-1.7\n documento oficial');
     }}
   });
   const pdf=await provider.printPdf({document:{
     kind:'NFSE',status:'AUTORIZADA_HOMOLOGACAO',access_key:key,
     issuer_snapshot_json:JSON.stringify(issuer)
   }});
   assert.match(pdf.toString(),/^%PDF-/);
   assert.equal(count,1);
   await assert.rejects(provider.printPdf({document:{
     kind:'NFSE',status:'REJEITADA',access_key:key,
     issuer_snapshot_json:JSON.stringify(issuer)
   }}),/autorizad|DANFSe/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
