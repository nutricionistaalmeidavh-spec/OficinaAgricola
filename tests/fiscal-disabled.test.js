import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isFiscalApiPath,isNativeFiscalPath,FISCAL_DISABLED_MESSAGE} from '../src/platform/fiscal-disabled.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('o bloqueio fiscal alcança todas as rotas e somente elas',()=>{
  for(const path of [
    '/api/fiscal','/api/fiscal/settings','/api/fiscal/drafts',
    '/api/fiscal/1/submit','/api/fiscal/1/nfse/dps',
    '/api/tenancy/os-transfer/42/fiscal/3/xml'
  ]) assert.equal(isFiscalApiPath(path),true,path);
  for(const path of ['/v1/fiscal','/v1/fiscal/settings','/v1/fiscal/nfse/route',
    '/v1/fiscal/1/submit','/v1/fiscal/1/nfse/prepare'])
    assert.equal(isNativeFiscalPath(path),true,path);
  for(const path of ['/api/finance','/api/fiscalized','/api/sales','/api/company',
    '/api/tenancy/os-transfer/42/dossier','/v1/finance','/v1/fiscalized'])
    assert.equal(isFiscalApiPath(path)||isNativeFiscalPath(path),false,path);
  assert.match(FISCAL_DISABLED_MESSAGE,/fiscal.*desativad/i);
});

test('API fiscal desativada em todos os backends, sem alterar endpoints comerciais',()=>{
  const postgres=read('src/platform/postgres-unified-gateway.js');
  const native=read('src/platform/async-workshop-handler.js');
  const legacy=read('src/server.js');
  const tenancy=read('src/platform/multi-tenant-server.js');
  assert.match(postgres,/isFiscalApiPath\(path\)/);
  assert.match(native,/isNativeFiscalPath\(path\)/);
  assert.match(legacy,/isFiscalApiPath\(url\.pathname\)/);
  assert.match(tenancy,/isFiscalApiPath\(path\)/);
  for(const source of [postgres,native,legacy,tenancy])
    assert.match(source,/FISCAL_DISABLED_MESSAGE/);
});

test('nenhum atalho fiscal aparece no cliente ou na preparação da oficina',()=>{
  const html=read('public/index.html');
  const shell=read('public/sw.js');
  const main=read('public/app-core.js');
  const setup=read('public/app-onboarding.js');
  const settings=read('public/app-admin.js');
  const sales=read('public/app-assistencia.js');
  const tenancy=read('public/app-tenancy.js');
  assert.doesNotMatch(html,/data-(?:mobile-)?page="fiscal"|src="\/app-fiscal\.js"/);
  assert.doesNotMatch(shell,/['"]\/app-fiscal\.js['"]/);
  assert.doesNotMatch(main,/\bfiscal:renderFiscal\b|\bfiscal,technicians\b/);
  for(const src of [setup,settings,sales,tenancy])
    assert.doesNotMatch(src,/navigate\('fiscal'\)|\/api\/fiscal|saleFiscalAction|data-fiscal-xml/);
  assert.doesNotMatch(setup,/Emissão de notas fiscais|Configurar emissão de notas|Certificado A1/);
  assert.doesNotMatch(settings,/Configuração fiscal|settingsFiscalOpen/);
});

test('instalador e startup não carregam nem montam o emissor fiscal',()=>{
  const startup=read('src/start-postgres-unified.js');
  const electron=read('electron/main.js');
  const builder=read('electron-builder.yml');
  const ps1=read('scripts/build-electron.ps1');
  const build=read('scripts/build.mjs');
  assert.doesNotMatch(startup,/createAcbrLibFiscalProvider|createNationalNfseProvider|resolveTenantFiscalProvider/);
  assert.doesNotMatch(electron,/configureBundledFiscal|OFICINA_BUNDLED_FISCAL_VERIFIED/);
  assert.doesNotMatch(builder,/build\/fiscal|build\/nfse-national|acbrlib-worker\.py/);
  assert.doesNotMatch(ps1,/stage-fiscal-bundle|stage-nfse-national|build-acbr-native|acbrlib-worker/);
  assert.doesNotMatch(build,/resolve\('src\/platform\/fiscal-bundle\.js'\)/);
});
