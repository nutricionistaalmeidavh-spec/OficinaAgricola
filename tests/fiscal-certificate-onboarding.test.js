import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createLocalFiscalCertificateStore} from '../src/platform/fiscal-certificate-store.js';
import {createAcbrLibFiscalProvider} from '../src/platform/acbrlib-fiscal-provider.js';

test('certificate onboarding is scoped to one company directory and rejects invalid PFX',async()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-cert-'));
 try{
  const a=createLocalFiscalCertificateStore({directory:join(root,'empresa-1','segredos')});
  const b=createLocalFiscalCertificateStore({directory:join(root,'empresa-2','segredos')});
  assert.equal(a.status().configured,false);
  assert.equal(b.status().configured,false);
  assert.throws(()=>a.install({pfxBase64:'invalid',password:'any'}),/PFX|certificado/);
  assert.throws(()=>a.install({pfxBase64:Buffer.from('fake').toString('base64'),password:'x'}),/PFX inválido|senha incorreta/);
  assert.equal(a.status().configured,false);
  assert.equal(b.status().configured,false);
  await assert.rejects(a.withConfig({kind:'NFE',environment:'HOMOLOGACAO',uf:'SP'},async()=>{}),/Cadastre/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('A1 PFX is encrypted at rest and ACBr temporary config is removed even after failure',async t=>{
 const openssl=spawnSync('openssl',['version'],{encoding:'utf8'});
 if(openssl.status!==0){t.skip('OpenSSL CLI unavailable in test runner');return;}
 const root=mkdtempSync(join(tmpdir(),'oficina-cert-pfx-'));
 try{
  const cmd=(args)=>{
    const result=spawnSync('openssl',args,{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,'OpenSSL fixture generation failed');
  };
  cmd(['req','-newkey','rsa:2048','-keyout','key.pem','-out','cert.pem','-nodes',
    '-x509','-days','2','-subj','/CN=Oficina QA']);
  cmd(['pkcs12','-export','-inkey','key.pem','-in','cert.pem','-out','cert.pfx',
    '-password','pass:QAFiscalSenha!']);
  const store=createLocalFiscalCertificateStore({directory:join(root,'unit-10','secure')});
  const pfx=readFileSync(join(root,'cert.pfx')).toString('base64');
  const installed=store.install({pfxBase64:pfx,password:'QAFiscalSenha!'});
  assert.equal(installed.configured,true);
  assert.equal(installed.certificateType,'A1');
  assert.ok(!JSON.stringify(installed).includes('QAFiscalSenha!'));
  const atRest=readFileSync(join(root,'unit-10','secure','certificate.enc.json'),'utf8');
  assert.ok(!atRest.includes('QAFiscalSenha!'));
  assert.ok(!atRest.includes(pfx));
  await assert.rejects(store.withConfig({
    kind:'NFE',environment:'HOMOLOGACAO',uf:'MG'
  },async ini=>{
    const data=readFileSync(ini,'utf8');
    assert.match(data,/\[DFe\]/);
    assert.match(data,/ArquivoPFX=/);
    assert.match(data,/Senha=QAFiscalSenha!/);
    assert.match(data,/\[NFe\]\nAmbiente=1/);
    throw Error('simular falha na SEFAZ');
  }),/simular/);
  assert.equal(readFileSync(join(root,'unit-10','secure','certificate.enc.json'),'utf8'),atRest);
  assert.equal(existsSync(join(root,'unit-10','secure','run-any')),false);
  const second=createLocalFiscalCertificateStore({directory:join(root,'unit-11','secure')});
  assert.equal(second.status().configured,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('diagnostics uses ACBr worker status, not fake authorization',async()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-cert-provider-'));
 try{
  // Precompiled provider can use an injected runner in tests; no Internet or certificate.
  const {writeFileSync,mkdirSync}=await import('node:fs');
  const dir=join(root,'input');mkdirSync(dir);
  for(const p of ['ACBrNFe64.dll','ACBrLibNFe.ini','worker.exe'])
    writeFileSync(join(root,p),'test');
  const observed=[];
  const fakeStore={status:()=>({configured:true}),
    withConfig:async (_settings,action)=>action(join(root,'ACBrLibNFe.ini')),
    install:()=>({configured:true})};
  const provider=createAcbrLibFiscalProvider({
    inputDir:dir,nfeLib:join(root,'ACBrNFe64.dll'),nfeConfig:join(root,'ACBrLibNFe.ini'),
    workerExe:join(root,'worker.exe'),certificateStore:fakeStore,
    runner:async req=>{observed.push(req);return req.operation==='certificate'
      ?{status:'CERTIFICATE_MATCH'}:{status:'ONLINE',code:'107'};}
  });
  const response=await provider.diagnose({settings:{enabled:1,environment:'HOMOLOGACAO',
    issuer_cnpj:'11222333000181',issuer_uf:'SP'}});
  assert.equal(response.ready,true);
  assert.equal(response.nfse.status,'VERIFICACAO_MUNICIPAL_NECESSARIA');
  assert.deepEqual(observed.map(x=>x.operation),['certificate','status']);
  assert.equal(observed[1].environment,'HOMOLOGACAO');
  assert.equal(observed[1].issuerUf,'SP');
  assert.equal(observed[1].kind,'NFE');
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('A3 selects Windows token for this unit without copying a PFX or saving PIN',async()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-cert-a3-'));
 try{
  const a=createLocalFiscalCertificateStore({directory:join(root,'empresa-A','segredos')});
  const b=createLocalFiscalCertificateStore({directory:join(root,'empresa-B','segredos')});
  assert.throws(()=>a.selectA3({serial:'xx\nbad',cnpj:'11222333000181'}),/série|serial/i);
  assert.throws(()=>a.selectA3({serial:'AABB1122',cnpj:'000'}),/CNPJ/i);
  assert.equal(a.selectA3({serial:'AABB11223344',cnpj:'11222333000181'}).certificateType,'A3');
  assert.equal(a.status().configured,true);
  assert.equal(b.status().configured,false);
  assert.equal(a.status().certificateType,'A3');
  await a.withConfig({kind:'NFE',environment:'HOMOLOGACAO',uf:'SP',cnpj:'11222333000181'},async ini=>{
    const text=readFileSync(ini,'utf8');
    assert.match(text,/NumeroSerie=AABB11223344/);
    assert.match(text,/SSLCryptLib=3/);
    assert.match(text,/SSLHttpLib=2/);
    assert.match(text,/SSLXmlSignLib=4/);
    assert.doesNotMatch(text,/Senha=|ArquivoPFX=|DadosPFX=/);
    assert.match(text,/\[NFe\]\nAmbiente=1/);
  });
  await assert.rejects(a.withConfig({kind:'NFE',environment:'HOMOLOGACAO',uf:'SP',cnpj:'77889911000100'},async()=>{}),/CNPJ/i);
  assert.ok(!JSON.stringify(a.status()).toLowerCase().includes('pin'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('A3 provider lists Windows certificates and binds selected serial to issuer CNPJ',async()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-cert-provider-a3-'));
 try{
  const {writeFileSync,mkdirSync}=await import('node:fs');
  const dir=join(root,'input');mkdirSync(dir);
  for(const name of ['ACBrNFe64.dll','ACBrLibNFe.ini','worker.exe'])writeFileSync(join(root,name),'test');
  const certificateStore=createLocalFiscalCertificateStore({directory:join(root,'empresa-2','segredos')});
  const observed=[];
  const provider=createAcbrLibFiscalProvider({inputDir:dir,nfeLib:join(root,'ACBrNFe64.dll'),
   nfeConfig:join(root,'ACBrLibNFe.ini'),workerExe:join(root,'worker.exe'),certificateStore,
   runner:async req=>{
     observed.push(req);
     if(req.operation==='certificates')return {status:'OK',certificates:[
      {serial:'AA998877',cnpj:'11222333000181',name:'Empresa A',validUntil:'31/12/2032'},
      {serial:'BB887766',cnpj:'99888777000166',name:'Empresa B',validUntil:'31/12/2032'}
     ]};
     return {status:'ONLINE',code:'107'};
   }});
  const settings={enabled:1,issuer_cnpj:'11222333000181',issuer_uf:'SP',environment:'HOMOLOGACAO'};
  const found=await provider.listCertificates({settings});
  assert.equal(found.length,1);
  assert.equal(found[0].serial,'AA998877');
  await assert.rejects(provider.selectA3Certificate({serial:'BB887766',settings}),/CNPJ|empresa|certificado/i);
  await assert.rejects(provider.selectA3Certificate({serial:'MISSING999',settings}),/série|serial|certificado/i);
  const selected=await provider.selectA3Certificate({serial:'AA998877',settings});
  assert.equal(selected.certificateType,'A3');
  assert.equal(certificateStore.status().certificateType,'A3');
  const status=await provider.diagnose({settings});
  assert.equal(status.ready,true);
  assert.equal(observed.at(-1).operation,'status');
  assert.equal(observed.at(-1).kind,'NFE');
 }finally{rmSync(root,{recursive:true,force:true});}
});
