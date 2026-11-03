import { chromium } from 'playwright';
import { verifyUiContract } from './qa-ui-contract.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const viewportName=process.argv[2]||'desktop';
const outputDir=path.resolve(process.argv[3]||`qa-artifacts-${viewportName}`);
const viewports={desktop:{width:1440,height:900},mobile:{width:390,height:844}};
const viewport=viewports[viewportName];
if(!viewport)throw new Error(`Viewport inválido: ${viewportName}`);

await rm(outputDir,{recursive:true,force:true});
await mkdir(outputDir,{recursive:true});
const videoTemp=path.join(outputDir,'.video');
await mkdir(videoTemp,{recursive:true});

const logs=[];
const server=spawn(process.execPath,['src/start.js'],{
  env:{...process.env,HOST:'127.0.0.1',PORT:'3344',DATABASE_PATH:'.qa/artisys-oficina.sqlite',STORAGE_DIR:'.qa/uploads'},
  stdio:['ignore','pipe','pipe']
});
server.stdout.on('data',d=>logs.push(d.toString()));
server.stderr.on('data',d=>logs.push(d.toString()));

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// QA usa os mesmos destinos reais da UI, inclusive o menu Mais no celular.
async function navigateQa(page,target){
  const direct=page.locator('[data-page="'+target+'"]');
  if(await direct.isVisible())return direct.click();
  const more=page.locator('#mobileMoreBtn');
  await more.click();
  const destination=page.locator('#mobileMorePanel [data-mobile-page="'+target+'"]');
  await destination.waitFor({state:'visible'});
  await destination.click();
}
async function waitForHealth(){
  const end=Date.now()+30000;
  while(Date.now()<end){
    try{const response=await fetch('http://127.0.0.1:3344/api/health');if(response.ok)return}catch{}
    await sleep(250);
  }
  throw new Error('Servidor QA não ficou pronto em 30s');
}

let browser=null,context=null,page=null,video=null;
try{
  await waitForHealth();
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport,recordVideo:{dir:videoTemp,size:viewport}});
  page=await context.newPage();
  video=page.video();

  await page.goto('http://127.0.0.1:3344',{waitUntil:'domcontentloaded'});
  await page.locator('#loginForm input[name="username"]').fill('admin');
  await page.locator('#loginForm input[name="password"]').fill('Admin@1234');
  await page.getByRole('button',{name:'Entrar'}).click();
  await page.locator('#appView').waitFor({state:'visible'});
  await page.locator('#pageTitle').filter({hasText:'Visão Geral'}).waitFor({state:'visible'});
  await page.locator('#content').filter({hasText:'João Silva'}).waitFor({state:'visible'});
  const uiGeometry=await verifyUiContract(page,viewportName,outputDir);
  await writeFile(path.join(outputDir,'ui-geometry.json'),JSON.stringify(uiGeometry,null,2));
  await sleep(700);
  await page.screenshot({path:path.join(outputDir,'01-dashboard.png'),fullPage:true});

  await navigateQa(page,'work-orders');
  await page.locator('.os-card').first().waitFor({state:'visible'});
  const ordersText=(await page.locator('#content').textContent())||'';
  if(!ordersText.includes('João Silva')||!ordersText.includes('Dell'))throw new Error('Dados técnicos de demonstração não aparecem nas OS');
  await sleep(700);
  await page.screenshot({path:path.join(outputDir,'02-ordens.png'),fullPage:true});

  // PR #14: criar OS encerrada via API real e verificar histórico, filtro, busca e modal.
  const archivedOsNumber=await page.evaluate(async()=>{
    const customers=await api('/api/customers');
    const machines=await api('/api/machines');
    const machine=machines.find(m=>m.customer_id===customers[0].id);
    if(!machine)throw new Error('QA: equipamento de cliente não encontrado');
    const os=await api('/api/work-orders',{method:'POST',body:{
      customerId:customers[0].id,machineId:machine.id,
      problemReported:'QA14 Historico Encerrado',requestId:newCommandId()
    }});
    await api('/api/work-orders/'+os.id+'/status',{method:'POST',body:{
      status:'CANCELADA',expectedVersion:os.version,requestId:newCommandId()
    }});
    return os.os_number;
  });
  await page.evaluate(()=>refreshCurrentPage());
  await page.locator('#osArchiveRows').filter({hasText:'QA14 Historico Encerrado'}).waitFor({state:'visible'});
  await page.locator('#osArchiveStatus').selectOption('ENTREGUE');
  await page.waitForFunction(()=>!document.querySelector('#osArchiveRows')?.textContent.includes('QA14 Historico Encerrado'));
  await page.locator('#osArchiveStatus').selectOption('CANCELADA');
  await page.locator('#osArchiveSearch').fill('QA14 Historico Encerrado');
  await page.locator('#osArchiveFilter').click();
  await page.locator('#osArchiveRows').filter({hasText:'QA14 Historico Encerrado'}).waitFor({state:'visible'});
  await page.locator('#osArchiveRows [data-os]').first().click();
  await page.locator('#modalTitle').filter({hasText:'OS #'+archivedOsNumber}).waitFor({state:'visible'});
  await page.locator('#modalClose').click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.screenshot({path:path.join(outputDir,'10-os-closed-history.png'),fullPage:true});



  await page.locator('.os-card').first().click();
  await page.getByRole('button',{name:'Gerar PDF'}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Histórico'}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Editar OS'}).waitFor({state:'visible'});
  await sleep(1000);
  await page.screenshot({path:path.join(outputDir,'03-os-detalhe.png'),fullPage:true});

  // Pós-save: a seção da lista deve manter o mesmo nó e não receber rerender total.
  await page.locator('#modalClose').click();
  await navigateQa(page,'customers');
  await page.locator('#newCustomer').waitFor({state:'visible'});
  await page.evaluate(()=>{window.__qaCustomerHeader=document.querySelector('#content .section-head')});
  await page.locator('#newCustomer').click();
  await page.locator('#modalBody input[name="name"]').fill('Cliente QA Canônico');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({hasText:'Cliente QA Canônico'}).waitFor({state:'visible'});
  const preserved=await page.evaluate(
    ()=>window.__qaCustomerHeader===document.querySelector('#content .section-head')
  );
  if(!preserved)throw new Error('Pós-save recriou o DOM da lista de clientes');
  await page.screenshot({path:path.join(outputDir,'04-cliente-sem-rerender.png'),fullPage:true});

  // P1: resposta de criação perdida após COMMIT; IndexedDB deve preservar
  // requestId e o reenvio após reload não pode cadastrar cliente duas vezes.
  const missingReplyName='Cliente QA Fila Confirmacao';
  let swallowedReply=false;
  const lostReply=async route=>{
    const request=route.request();
    if(request.method()!=='POST'||!request.postData()?.includes(missingReplyName))
      return route.continue();
    if(swallowedReply)return route.continue();
    swallowedReply=true;
    const backend=await route.fetch();
    if(!backend.ok())throw new Error('Backend não confirmou operação durante QA da fila');
    await route.abort('failed'); // servidor confirmou, browser não recebeu a resposta
  };
  await page.route('**/api/customers',lostReply);
  await page.locator('#newCustomer').click();
  await page.locator('#modalBody input[name="name"]').fill(missingReplyName);
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#pendingCommands').waitFor({state:'visible'});
  if(!swallowedReply)throw new Error('Interceptação de resposta perdida não ocorreu');
  const queued=await page.evaluate(async()=>{
    const commands=await window.OficinaCommands.openIndexedDB().list(currentCommandOwner());
    return commands.map(c=>({
      method:c.method,path:c.path,requestId:c.body.requestId,
      hasToken:JSON.stringify(c).includes('Bearer ')
    }));
  });
  if(queued.length!==1||!queued[0].requestId||queued[0].hasToken)
    throw new Error('Fila não persistiu chave única sem token');
  await page.screenshot({path:path.join(outputDir,'07-operacao-pendente.png'),fullPage:true});
  await page.unroute('**/api/customers',lostReply);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#appView').waitFor({state:'visible'});
  await page.waitForFunction(async()=>{
    if(!state.user)return false;
    return (await window.OficinaCommands.openIndexedDB().list(currentCommandOwner())).length===0;
  },null,{timeout:20000});
  const afterReplay=await page.evaluate(()=>api('/api/customers'));
  if(afterReplay.filter(c=>c.name===missingReplyName).length!==1)
    throw new Error('Reenvio da fila duplicou cliente após perder resposta');
  await page.locator('#pendingCommands').waitFor({state:'hidden'});
  await page.screenshot({path:path.join(outputDir,'08-operacao-recuperada.png'),fullPage:true});

  // P2: servidor não recebeu a primeira tentativa; funcionário confirma
  // manualmente pela faixa no topo sem duplicação ou exposição de requestId.
  const manualName='Cliente QA Reenvio Manual';
  const noNetwork=async route=>{
    if(route.request().method()==='POST'&&route.request().postData()?.includes(manualName))
      return route.abort('failed');
    return route.continue();
  };
  await page.route('**/api/customers',noNetwork);
  await navigateQa(page,'customers');
  await page.locator('#newCustomer').click();
  await page.locator('#modalBody input[name="name"]').fill(manualName);
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#pendingCommands').waitFor({state:'visible'});
  await page.unroute('**/api/customers',noNetwork);
  await page.locator('#pendingCommands').click();
  // A fila de risco exige confirmação no diálogo, antes de retornar à navegação.
  const retry=page.locator('[data-queue-retry]').first();
  await retry.waitFor({state:'visible'});
  if((await retry.textContent()).includes('Revisar')){
    await retry.click();
    await page.getByRole('button',{name:'Confirmar tentativa desta operação'}).waitFor({state:'visible'});
  }
  await retry.click();
  await page.locator('#pendingCommands').waitFor({state:'hidden',timeout:20000});
  await page.locator('#modal').waitFor({state:'hidden'});
  const manualCustomers=await page.evaluate(()=>api('/api/customers'));
  if(manualCustomers.filter(c=>c.name===manualName).length!==1)
    throw new Error('Recuperação manual não gravou exatamente um cliente');



  // Draft settings form: a background refresh must preserve the node, focus and user edit.
  await navigateQa(page,'settings');
  const companyName=page.locator('#companyForm input[name="name"]');
  await companyName.waitFor({state:'visible'});
  await companyName.fill('Rascunho QA não salvo');
  await page.evaluate(()=>{window.__qaSettingsInput=document.querySelector('#companyForm input[name="name"]')});
  await page.evaluate(()=>refreshCurrentPage());
  const settingsStable=await page.evaluate(()=>({
    same:window.__qaSettingsInput===document.querySelector('#companyForm input[name="name"]'),
    draft:document.querySelector('#companyForm input[name="name"]').value,
    focused:document.activeElement===document.querySelector('#companyForm input[name="name"]')
  }));
  if(!settingsStable.same||!settingsStable.focused||settingsStable.draft!=='Rascunho QA não salvo')
    throw new Error('Atualização parcial descartou campo, foco ou nó de formulário não salvo');

  // Automotivo: criação e leitura real de placa/VIN/km, revisão e garantia.
  await navigateQa(page,'machines');
  await page.locator('#newMachine').click();
  await page.locator('#modalBody select[name="customerId"]').selectOption({index:1});
  await page.locator('#modalBody input[name="type"]').fill('Carro');
  await page.locator('#modalBody input[name="brand"]').fill('VW');
  await page.locator('#modalBody input[name="model"]').fill('Gol QA');
  await page.locator('#modalBody input[name="plate"]').fill('QAB2C34');
  await page.locator('#modalBody input[name="vin"]').fill('9BWZZZ377VT004251');
  await page.locator('#modalBody input[name="odometerKm"]').fill('10520');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#content').filter({hasText:'QAB2C34'}).waitFor({state:'visible'});
  await page.locator('[data-history]').first().click();
  await page.locator('#newReview').click();
  await page.locator('#modalBody input[name="performedAt"]').fill('2026-11-02');
  await page.locator('#modalBody input[name="nextDueKm"]').fill('20000');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#modalBody').filter({hasText:'Revisão'}).waitFor({state:'visible'});
  await page.locator('#newWarranty').click();
  await page.locator('#modalBody input[name="warrantyUntil"]').fill('2027-11-02');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#modalBody').filter({hasText:'Garantia'}).waitFor({state:'visible'});
  await page.screenshot({path:path.join(outputDir,'05-historico-automotivo.png'),fullPage:true});

  // P0 fiscal: a UI deve mostrar claramente que rascunhos não são notas autorizadas.
  await page.locator('#modalClose').click();
  await navigateQa(page,'fiscal');
  await page.locator('#fiscalNew').waitFor({state:'visible'});
  await page.locator('#content').filter({hasText:'Um rascunho'}).waitFor({state:'visible'});
  await page.screenshot({path:path.join(outputDir,'09-fiscal-nao-autorizado.png'),fullPage:true});
  await page.locator('#fiscalSettings').click();
  await page.locator('#modalBody input[name="issuerCnpj"]').waitFor({state:'visible'});
  await page.locator('#modalClose').click();
  await page.locator('#fiscalNew').click();
  await page.locator('#modalBody select[name="kind"]').waitFor({state:'visible'});
  await page.locator('#modalClose').click();
  await navigateQa(page,'reports');
  await page.locator('#content').filter({hasText:'OS entregues no mês'}).waitFor({state:'visible'});
  await page.screenshot({path:path.join(outputDir,'10-relatorios-sql.png'),fullPage:true});



  // Fresh installation browser flow. This server uses its own disposable SQLite file.
  const setupPort=viewportName==='desktop'?3355:3356;
  const setupFile=`.qa/onboarding-${viewportName}.sqlite`;
  await rm(setupFile,{force:true});
  const setupProcess=spawn(process.execPath,['src/start.js'],{
    env:{...process.env,HOST:'127.0.0.1',PORT:String(setupPort),
      DATABASE_PATH:setupFile,STORAGE_DIR:`.qa/onboarding-${viewportName}-uploads`,
      NODE_ENV:'production',ADMIN_PASSWORD:''},
    stdio:['ignore','pipe','pipe']
  });
  try{
    let ready=false;
    for(let i=0;i<120;i++){
      if(setupProcess.exitCode!==null)throw new Error('Servidor de primeiro acesso encerrou');
      try{const r=await fetch(`http://127.0.0.1:${setupPort}/api/health`);if(r.ok){ready=true;break}}catch{}
      await sleep(250);
    }
    if(!ready)throw new Error('Servidor de primeiro acesso não iniciou');
    const first=await context.newPage();
    try{
      await first.goto(`http://127.0.0.1:${setupPort}`,{waitUntil:'domcontentloaded'});
      await first.locator('#setupForm').waitFor({state:'visible'});
      await first.locator('#loginForm').waitFor({state:'hidden'});
      await first.locator('#setupForm input[name="name"]').fill('Gestor Primeiro Acesso');
      await first.locator('#setupForm input[name="username"]').fill('gestorqa');
      await first.locator('#setupForm input[name="password"]').fill('PrimeiroAcessoQA2026!');
      await first.locator('#setupForm input[name="confirmPassword"]').fill('PrimeiroAcessoQA2026!');
      await first.locator('#setupForm button[type="submit"]').click();
      await first.locator('#loginForm').waitFor({state:'visible'});
      await first.locator('#loginForm input[name="username"]').fill('gestorqa');
      await first.locator('#loginForm input[name="password"]').fill('PrimeiroAcessoQA2026!');
      await first.locator('#loginForm button[type="submit"]').click();
      await first.locator('#appView').waitFor({state:'visible'});
      await first.screenshot({path:path.join(outputDir,'06-primeiro-acesso-seguro.png')});
    }finally{await first.close()}
  }finally{setupProcess.kill('SIGTERM')}

  await writeFile(path.join(outputDir,'qa-summary.json'),`${JSON.stringify({status:'passed',viewport:viewportName,checks:['navigation-contrast-aa','mobile-nav-no-overlap','mobile-global-search','server-status-in-flow','modal-focus-trap-restore','modal-background-inert','form-error-draft-recovery','unsaved-discard-confirmation','keyboard-os-card','reduced-motion','login','dashboard','demo-data','work-orders','os-detail','edit-action','pdf-action','history-action','client-save-without-rerender','settings-draft-focus-preserved','vehicle-identity','review-and-warranty','fiscal-read-only-and-config','reports-sql','first-run-admin-browser','durable-command-lost-response','offline-manual-command-retry']},null,2)}\n`);
} catch(error){
  if(page)await page.screenshot({path:path.join(outputDir,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(path.join(outputDir,'qa-summary.json'),`${JSON.stringify({status:'failed',viewport:viewportName,error:error.message},null,2)}\n`).catch(()=>{});
  throw error;
} finally {
  if(context)await context.close().catch(()=>{});
  if(video)await video.saveAs(path.join(outputDir,'qa-video.webm')).catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  server.kill('SIGTERM');
  await writeFile(path.join(outputDir,'server.log'),logs.join('')).catch(()=>{});
  await rm(videoTemp,{recursive:true,force:true}).catch(()=>{});
}

