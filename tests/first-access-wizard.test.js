import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app-onboarding.js',import.meta.url),'utf8');
function harness(api=async()=>({})){
  const store=new Map();
  const win={OficinaTenant:{getUnitId:()=> '7'},state:{user:{id:3}}};
  const context={
    window:win,api,
    localStorage:{
      getItem:key=>store.get(key)||null,
      setItem:(key,value)=>store.set(key,value),
      removeItem:key=>store.delete(key)
    }
  };
  runInNewContext(source,context,{filename:'app-onboarding.js'});
  return win.OficinaFirstAccess;
}
const company={name:'Oficina Exemplo',document:'11.222.333/0001-81',
  address:'Rua das Flores, 100',service_profile:'AUTOMOTIVA'};
const health={ok:true,operationalApiReady:true};
const fiscal={companyConfigured:true,certificate:{configured:true},providerReady:true,
  taxProfileVerified:false,authorizationVerified:false};
const settings={environment:'HOMOLOGACAO',production_confirmed:false};

test('primeiro acesso: instalação saudável não substitui cadastro da empresa',()=>{
  const {evaluate}=harness();
  const noCompany=evaluate({health});
  assert.equal(noCompany.operationReady,false);
  assert.equal(noCompany.coreCompleted,1);
  const ready=evaluate({health,company});
  assert.equal(ready.operationReady,true);
  assert.equal(ready.pendingCore,0);
  assert.equal(ready.fiscalProduction,false);
  assert.equal(ready.unitId,'7');
});
test('primeiro acesso: cadastro empresarial incompleto não é marcado como pronto',()=>{
  const {evaluate}=harness();
  for(const key of ['name','document','address','service_profile']){
    const incomplete={...company,[key]:''};
    assert.equal(evaluate({health,company:incomplete}).operationReady,false,key);
  }
  assert.equal(evaluate({health:{ok:true},company}).operationReady,false);
});
test('primeiro acesso: serviços e técnicos são opcionais na liberação operacional',()=>{
  const {evaluate}=harness();
  const none=evaluate({health,company,services:[],technicians:[]});
  assert.equal(none.operationReady,true);
  assert.equal(none.operationsConfigured,false);
  const configured=evaluate({health,company,services:[{id:1}],technicians:[{id:2}]});
  assert.equal(configured.operationsConfigured,true);
});
test('primeiro acesso: certificado não libera produção nem equivale a homologação',()=>{
  const {evaluate}=harness();
  const candidate=evaluate({health,company,fiscal,settings});
  assert.equal(candidate.fiscalTestEligible,true);
  assert.equal(candidate.fiscalState,'PREPARADO_PARA_HOMOLOGACAO');
  assert.equal(candidate.fiscalProduction,false);
  const confirmOnly=evaluate({health,company,fiscal,settings:{
    environment:'PRODUCAO',production_confirmed:true
  }});
  assert.equal(confirmOnly.fiscalProduction,false);
  const authorized=evaluate({health,company,fiscal:{
    ...fiscal,authorizationVerified:true,taxProfileVerified:true
  },settings:{environment:'PRODUCAO',production_confirmed:true}});
  assert.equal(authorized.fiscalProduction,true);
});
test('primeiro acesso: status indisponível nunca é considerado sucesso e retoma pelos dados reais',async()=>{
  let configured=false;
  const api=async path=>{
    if(path==='/api/health')return health;
    if(path==='/api/company')return configured?company:{name:'',document:'',address:'',service_profile:''};
    if(path==='/api/services')return [];
    if(path==='/api/technicians')return [];
    if(path==='/api/fiscal/onboarding')throw Error('SEFAZ indisponível');
    if(path==='/api/fiscal/settings')return settings;
    throw Error('Rota inesperada');
  };
  const service=harness(api);
  const initial=await service.readStatus();
  assert.equal(initial.operationReady,false);
  assert.equal(initial.fiscalTestEligible,false);
  assert.equal(initial.unavailable,1);
  configured=true;
  const resumed=await service.readStatus();
  assert.equal(resumed.operationReady,true);
  assert.equal(resumed.unavailable,1);
});
test('primeiro acesso: UI é carregada após fiscal e ligada à página inicial',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const core=readFileSync(new URL('../public/app-core.js',import.meta.url),'utf8');
  assert.ok(html.indexOf('/app-fiscal.js')<html.indexOf('/app-onboarding.js'));
  assert.match(core,/await window\.OficinaFirstAccess\.renderBanner\(\)/);
  assert.doesNotMatch(source,/productionConfirmed:\s*true|authorizationVerified:\s*true/);
});
