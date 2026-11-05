import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createLocalFiscalCertificateStore} from '../src/platform/fiscal-certificate-store.js';
import {createAcbrLibFiscalProvider} from '../src/platform/acbrlib-fiscal-provider.js';

test('certificate onboarding is scoped to one company directory and rejects invalid PFX',()=>{
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
  let observed=null;
  const fakeStore={status:()=>({configured:true}),
    withConfig:async (_settings,action)=>action(join(root,'ACBrLibNFe.ini')),
    install:()=>({configured:true})};
  const provider=createAcbrLibFiscalProvider({
    inputDir:dir,nfeLib:join(root,'ACBrNFe64.dll'),nfeConfig:join(root,'ACBrLibNFe.ini'),
    workerExe:join(root,'worker.exe'),certificateStore:fakeStore,
    runner:async req=>{observed=req;return {status:'ONLINE',code:'107'};}
  });
  const response=await provider.diagnose({settings:{enabled:1,environment:'HOMOLOGACAO',
    issuer_cnpj:'11222333000181',issuer_uf:'SP'}});
  assert.equal(response.ready,true);
  assert.equal(response.nfse.status,'VERIFICACAO_MUNICIPAL_NECESSARIA');
  assert.equal(observed.operation,'status');
  assert.equal(observed.environment,'HOMOLOGACAO');
  assert.equal(observed.issuerUf,'SP');
  assert.equal(observed.kind,'NFE');
 }finally{rmSync(root,{recursive:true,force:true});}
});
