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
  const inconsistent=evaluate({health,company,fiscal:{
    ...fiscal,authorizationVerified:true,taxProfileVerified:true,productionReady:false
  },settings:{environment:'PRODUCAO',production_confirmed:true}});
  assert.equal(inconsistent.fiscalProduction,false);
  const authorized=evaluate({health,company,fiscal:{
    ...fiscal,authorizationVerified:true,taxProfileVerified:true,productionReady:true,
    models:{NFE:{productionReady:true,homologationVerified:true}}
  },settings:{environment:'PRODUCAO',production_confirmed:true}});
  assert.equal(authorized.fiscalProduction,true);
  assert.equal(authorized.fiscalHomologationVerified,true);
  assert.equal(authorized.fiscalModels.NFE.productionReady,true);
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
  const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  assert.ok(sw.includes("'/app-onboarding.js'"));
  assert.ok(sw.includes("'/app-fiscal.js'"));
  assert.match(core,/await window\.OficinaFirstAccess\.renderBanner\(\)/);
  assert.doesNotMatch(source,/productionConfirmed:\s*true|authorizationVerified:\s*true/);
});


function uiHarness(){
  const store=new Map();let modal=null,banner=null;
  const state={user:{id:3,role:'ADMIN'},page:'dashboard'};
  const host={isConnected:true,querySelector:()=>null,prepend(node){banner=node;}};
  const document={
    querySelector:selector=>selector==='#content'?host:
      selector==='#modalBody'?{querySelectorAll:()=>[]}:null,
    createElement:()=>({setAttribute(){},querySelectorAll:()=>[],innerHTML:'',className:''})
  };
  const api=async path=>{
    if(path==='/api/health')return health;
    if(path==='/api/company')return company;
    if(path==='/api/services'||path==='/api/technicians')return [];
    if(path==='/api/fiscal/onboarding')return fiscal;
    if(path==='/api/fiscal/settings')return settings;
    throw Error('Unexpected API: '+path);
  };
  const win={OficinaTenant:{getUnitId:()=> '7'},state};
  const context={
    window:win,state,api,document,
    showModal:(title,html)=>{modal={title,html};},
    esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    localStorage:{
      getItem:k=>store.get(k)||null,
      setItem:(k,v)=>store.set(k,v),
      removeItem:k=>store.delete(k)
    }
  };
  runInNewContext(source,context,{filename:'app-onboarding.js'});
  return {ui:win.OficinaFirstAccess,modal:()=>modal,banner:()=>banner,store};
}
test('primeiro acesso: apresenta quatro etapas em linguagem de oficina e progresso real',()=>{
  const {ui}=uiHarness();
  const s=ui.evaluate({health,company,services:[],technicians:[],fiscal,settings});
  const steps=ui.customerSteps(s);
  assert.equal(steps.length,4);
  assert.deepEqual(Array.from(steps,x=>x.id),['system','company','team','fiscal']);
  assert.equal(steps[0].state,'done');
  assert.equal(steps[1].state,'done');
  assert.equal(steps[2].state,'optional');
  assert.equal(steps[3].state,'optional');
  assert.equal(ui.customerProgress(s).completed,2);
  assert.equal(ui.customerProgress(s).total,4);
  assert.equal(ui.customerProgress(s).percentage,50);
  assert.equal(s.operationReady,true);
});
test('primeiro acesso: progresso fiscal separado não impede o uso da oficina',()=>{
  const {ui}=uiHarness();
  const ready=ui.evaluate({health,company,services:[],technicians:[],fiscal:{
    ...fiscal,authorizationVerified:true,productionReady:true,
    models:{NFE:{productionReady:true},NFCE:{productionReady:false}}
  },settings:{environment:'PRODUCAO',production_confirmed:true}});
  assert.equal(ready.operationReady,true);
  assert.equal(ui.customerSteps(ready)[3].state,'done');
  assert.equal(ui.customerProgress(ready).completed,3);
  const pending=ui.evaluate({health,company:null,fiscal:{
    ...fiscal,productionReady:true
  }});
  assert.equal(pending.operationReady,false);
  assert.equal(ui.customerSteps(pending)[1].state,'pending');
});
test('primeiro acesso: dashboard e modal sem códigos P0-P7 nem QA técnico e com ações acessíveis',async()=>{
  const {ui,modal,banner}=uiHarness();
  await ui.renderBanner();
  const card=banner();
  assert.ok(card);
  assert.match(card.innerHTML,/Prepare sua oficina/);
  assert.match(card.innerHTML,/2 de 4/);
  assert.match(card.innerHTML,/role="progressbar"/);
  assert.match(card.innerHTML,/Sua oficina já pode funcionar/);
  assert.match(card.innerHTML,/data-first-access-action="open"/);
  await ui.openWizard();
  const view=modal();
  assert.ok(view);
  assert.match(view.html,/Equipe e serviços/);
  assert.match(view.html,/Emissão de notas fiscais/);
  assert.match(view.html,/Começar a trabalhar/);
  assert.match(view.html,/data-first-access-action="fiscal"/);
  assert.doesNotMatch(card.innerHTML+view.html,/P[0-7]\s*[—-]|QA de distribuição|PostgreSQL|ACBr|pipeline do instalador/);
  assert.doesNotMatch(view.html,/authorizationVerified|production_confirmed|taxProfileVerified/);
});
test('primeiro acesso: CSS isolado e telas pequenas com alvos de toque adequados',()=>{
  const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.first-access-step/);
  assert.match(css,/\.first-access-progress/);
  assert.match(css,/\.first-access-action/);
  assert.match(css,/@media\s*\(max-width:\s*640px\)/);
  assert.match(css,/min-height:\s*44px/);
});
