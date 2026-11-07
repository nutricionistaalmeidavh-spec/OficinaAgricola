import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app-onboarding.js',import.meta.url),'utf8');
const company={name:'Oficina Exemplo',document:'11.222.333/0001-81',
  address:'Rua das Flores, 100',service_profile:'AUTOMOTIVA'};
const health={ok:true,operationalApiReady:true};

function harness(api=async()=>({}),interactive=false){
 const store=new Map();
 const state={user:{id:3,role:'ADMIN'},page:'dashboard'};
 const win={OficinaTenant:{getUnitId:()=> '7'},state};
 let modal=null,banner=null;
 const host={isConnected:true,querySelector:()=>null,prepend(node){banner=node;}};
 const document={
   querySelector:selector=>selector==='#content'?host:selector==='#modalBody'?{querySelectorAll:()=>[]}:null,
   createElement:()=>({setAttribute(){},querySelectorAll:()=>[],innerHTML:'',className:''})
 };
 const context={
  window:win,state,api,document,
  showModal:(title,html)=>{modal={title,html};},
  esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  localStorage:{
    getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),
    removeItem:k=>store.delete(k)
  }
 };
 runInNewContext(source,context,{filename:'app-onboarding.js'});
 return {ui:win.OficinaFirstAccess,modal:()=>modal,banner:()=>banner,store};
}

test('onboarding: a instalação depende apenas do core e cadastro da oficina',()=>{
 const {evaluate}=harness().ui;
 assert.equal(evaluate({health}).operationReady,false);
 assert.equal(evaluate({health}).coreCompleted,1);
 const ready=evaluate({health,company});
 assert.equal(ready.operationReady,true);
 assert.equal(ready.pendingCore,0);
 assert.equal(ready.coreTotal,2);
 assert.equal(ready.unitId,'7');
 for(const key of ['name','document','address','service_profile']){
  assert.equal(evaluate({health,company:{...company,[key]:''}}).operationReady,false,key);
 }
 assert.equal(evaluate({health:{ok:true},company}).operationReady,false);
});

test('onboarding: equipe e serviços opcionais, nenhuma etapa fiscal',()=>{
 const {evaluate,customerSteps,customerProgress}=harness().ui;
 const empty=evaluate({health,company,services:[],technicians:[]});
 const steps=customerSteps(empty);
 assert.deepEqual(Array.from(steps,step=>step.id),['system','company','team']);
 assert.equal(steps[2].state,'optional');
 assert.equal(customerProgress(empty).completed,2);
 assert.equal(customerProgress(empty).total,3);
 assert.equal(customerProgress(empty).percentage,67);
 const complete=evaluate({health,company,services:[{id:1}],technicians:[{id:1}]});
 assert.equal(complete.operationsConfigured,true);
 assert.equal(customerProgress(complete).percentage,100);
});

test('onboarding: status indisponível não compromete o uso operacional',async()=>{
 let configured=false,paths=[];
 const api=async path=>{
  paths.push(path);
  if(path==='/api/health')return health;
  if(path==='/api/company')return configured?company:{name:'',document:'',address:'',service_profile:''};
  if(path==='/api/services')return [];
  if(path==='/api/technicians')return [];
  throw Error('Rota inesperada: '+path);
 };
 const service=harness(api).ui;
 const initial=await service.readStatus();
 assert.equal(initial.operationReady,false);
 assert.equal(initial.unavailable,0);
 configured=true;
 const resumed=await service.readStatus();
 assert.equal(resumed.operationReady,true);
 assert.equal(resumed.unavailable,0);
 assert.equal(paths.length,8);
 assert.ok(paths.every(path=>!path.includes('fiscal')));
});

test('onboarding: DOM carrega somente interface operacional',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
 const core=readFileSync(new URL('../public/app-core.js',import.meta.url),'utf8');
 assert.ok(html.includes('/app-onboarding.js'));
 assert.ok(sw.includes("'/app-onboarding.js'"));
 assert.doesNotMatch(html,/\/app-fiscal\.js|data-page="fiscal"/);
 assert.doesNotMatch(sw,/\/app-fiscal\.js/);
 assert.match(core,/await window\.OficinaFirstAccess\.renderBanner\(\)/);
});

test('onboarding: dashboard, modal e progresso mostram três etapas sem fiscal',async()=>{
 const {ui,modal,banner}=harness(async path=>{
   if(path==='/api/health')return health;
   if(path==='/api/company')return company;
   if(path==='/api/services'||path==='/api/technicians')return [];
   throw Error('Unexpected API: '+path);
 });
 await ui.renderBanner();
 const card=banner();
 assert.ok(card);
 assert.match(card.innerHTML,/Prepare sua oficina/);
 assert.match(card.innerHTML,/2 de 3/);
 assert.match(card.innerHTML,/role="progressbar"/);
 assert.match(card.innerHTML,/Sua oficina já pode funcionar/);
 await ui.openWizard();
 const view=modal();
 assert.match(view.html,/Equipe e serviços/);
 assert.match(view.html,/Começar a trabalhar/);
 assert.doesNotMatch(card.innerHTML+view.html,/fiscal|tribut|nota|certificado|ACBr|P[0-7]\s*[—-]/i);
});

test('onboarding: responsivo e alvo de toque apropriado',()=>{
 const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
 assert.match(css,/\.first-access-step/);
 assert.match(css,/\.first-access-progress/);
 assert.match(css,/@media\s*\(max-width:\s*640px\)/);
 assert.match(css,/min-height:\s*44px/);
});
