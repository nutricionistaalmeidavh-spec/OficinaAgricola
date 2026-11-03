import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureBundledFiscal,verifyBundledFiscal} from '../src/platform/fiscal-bundle.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'oficina-fiscal-bundle-'));
  const resources=join(root,'resources'),fiscal=join(resources,'fiscal'),profile=join(root,'profile');
  mkdirSync(fiscal,{recursive:true});
  const files={
    'acbrlib-worker.exe':'test-worker-binary',
    'ACBrNFe64.dll':'native-nfe-binary',
    'ACBrNFSe64.dll':'native-nfse-binary',
    'deps/libcrypto-3-x64.dll':'test-dependency'
  };
  mkdirSync(join(fiscal,'deps'));
  for(const [name,data] of Object.entries(files))writeFileSync(join(fiscal,name),data);
  const manifest={
    schemaVersion:1,architecture:'x64',source:'https://svn.code.sf.net/p/acbr/code/trunk2',
    revision:'48608',files:Object.fromEntries(Object.entries(files).map(([name,data])=>[name,hash(data)]))
  };
  writeFileSync(join(fiscal,'acbr-bundle.json'),JSON.stringify(manifest));
  return {root,resources,fiscal,profile,manifest,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('core offline: bundle ausente não cria configurações, não requer Python nem ACBr',()=>{
  const f=fixture();
  try{
    const env={};
    const result=configureBundledFiscal({resourcesPath:join(f.root,'absent'),dataRoot:f.profile,platform:'win32',arch:'x64',env});
    assert.equal(result.active,false);
    assert.equal(env.FISCAL_ACBR_NFE_LIB,undefined);
    assert.equal(env.FISCAL_ACBR_WORKER_EXE,undefined);
  }finally{f.cleanup()}
});

test('bundle Windows íntegro identifica duas DLLs e executor, configura só perfil privado',()=>{
  const f=fixture();
  try{
    assert.equal(verifyBundledFiscal({resourcesPath:f.resources,platform:'win32',arch:'x64'}).valid,true);
    const env={};
    const result=configureBundledFiscal({resourcesPath:f.resources,dataRoot:f.profile,platform:'win32',arch:'x64',env});
    assert.equal(result.active,true);
    assert.equal(env.FISCAL_ACBR_NFE_LIB,join(f.fiscal,'ACBrNFe64.dll'));
    assert.equal(env.FISCAL_ACBR_NFSE_LIB,join(f.fiscal,'ACBrNFSe64.dll'));
    assert.equal(env.FISCAL_ACBR_WORKER_EXE,join(f.fiscal,'acbrlib-worker.exe'));
    assert.equal(env.FISCAL_ACBR_PYTHON,undefined);
    assert.match(readFileSync(env.FISCAL_ACBR_NFE_CONFIG,'utf8'),/\[Principal\]/);
    assert.ok(env.FISCAL_ACBR_INPUT_DIR.startsWith(f.profile));
    assert.equal(readFileSync(join(f.fiscal,'ACBrNFe64.dll'),'utf8'),'native-nfe-binary');
    writeFileSync(env.FISCAL_ACBR_NFE_CONFIG,'[Principal]\nCertificado=PRIVADO\n');
    configureBundledFiscal({resourcesPath:f.resources,dataRoot:f.profile,platform:'win32',arch:'x64',env});
    assert.match(readFileSync(env.FISCAL_ACBR_NFE_CONFIG,'utf8'),/Certificado=PRIVADO/);
  }finally{f.cleanup()}
});

test('integridade: DLL adulterada, arquivo faltando ou manifesto malformado desabilitam fiscal',()=>{
  const f=fixture();
  try{
    writeFileSync(join(f.fiscal,'ACBrNFe64.dll'),'altered');
    assert.equal(verifyBundledFiscal({resourcesPath:f.resources,platform:'win32',arch:'x64'}).valid,false);
    const env={};
    const r=configureBundledFiscal({resourcesPath:f.resources,dataRoot:f.profile,platform:'win32',arch:'x64',env});
    assert.equal(r.active,false);
    assert.equal(Object.keys(env).length,0);
    assert.equal(verifyBundledFiscal({resourcesPath:f.resources,platform:'linux',arch:'x64'}).valid,false);
  }finally{f.cleanup()}
});

test('configuração manual explícita não é sobrescrita pela descoberta do bundle',()=>{
  const f=fixture();
  try{
    const env={FISCAL_ACBR_NFE_LIB:'C:\\\\acbr-externo\\\\ACBrNFe64.dll'};
    const r=configureBundledFiscal({resourcesPath:f.resources,dataRoot:f.profile,platform:'win32',arch:'x64',env});
    assert.equal(r.active,false);
    assert.match(r.reason,/manual/i);
    assert.equal(env.FISCAL_ACBR_NFE_LIB,'C:\\\\acbr-externo\\\\ACBrNFe64.dll');
  }finally{f.cleanup()}
});
