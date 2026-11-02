import { chromium } from 'playwright';
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
  await sleep(700);
  await page.screenshot({path:path.join(outputDir,'01-dashboard.png'),fullPage:true});

  await page.locator('[data-page="work-orders"]').click();
  await page.locator('.os-card').first().waitFor({state:'visible'});
  const ordersText=(await page.locator('#content').textContent())||'';
  if(!ordersText.includes('João Silva')||!ordersText.includes('Dell'))throw new Error('Dados técnicos de demonstração não aparecem nas OS');
  await sleep(700);
  await page.screenshot({path:path.join(outputDir,'02-ordens.png'),fullPage:true});

  await page.locator('.os-card').first().click();
  await page.getByRole('button',{name:'Gerar PDF'}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Histórico'}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Editar OS'}).waitFor({state:'visible'});
  await sleep(1000);
  await page.screenshot({path:path.join(outputDir,'03-os-detalhe.png'),fullPage:true});

  // Pós-save: a seção da lista deve manter o mesmo nó e não receber rerender total.
  await page.locator('#modalClose').click();
  await page.locator('[data-page="customers"]').click();
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


  // Draft settings form: a background refresh must preserve the node, focus and user edit.
  await page.locator('[data-page="settings"]').click();
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
  await page.locator('[data-page="machines"]').click();
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


  // P0: navegação, filtro de encerradas, fechamento contado e perfis reais.
  await page.locator('#modalClose').click();
  const adminToken=await page.evaluate(()=>localStorage.getItem('oficina_token'));
  const qaRequest=async(path,method='GET',body=null,token=adminToken)=>{
    const response=await fetch('http://127.0.0.1:3344'+path,{
      method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined
    });
    const data=await response.json();
    if(!response.ok)throw new Error('QA API '+path+' '+response.status+' '+JSON.stringify(data));
    return data;
  };
  const qaCustomer=(await qaRequest('/api/customers'))[0];
  const qaMachine=(await qaRequest('/api/machines')).find(item=>item.customer_id===qaCustomer.id);
  if(!qaMachine)throw new Error('Sem equipamento QA associado ao cliente');
  const closedOrder=await qaRequest('/api/work-orders','POST',{customerId:qaCustomer.id,machineId:qaMachine.id,problemReported:'P0 Historico QA encerrado'});
  await qaRequest('/api/work-orders/'+closedOrder.id+'/status','POST',{status:'CANCELADA'});
  await page.locator('[data-page="work-orders"]').click();
  await page.locator('#osArchiveRows').filter({hasText:'P0 Historico QA encerrado'}).waitFor({state:'visible'});
  await page.locator('#osArchiveStatus').selectOption('ENTREGUE');
  await page.locator('#osArchiveRows').filter({hasText:'Nenhuma OS encerrada encontrada.'}).waitFor({state:'visible'});
  await page.locator('#osArchiveStatus').selectOption('CANCELADA');
  await page.locator('#osArchiveSearch').fill('P0 Historico QA encerrado');
  await page.locator('#osArchiveFilter').click();
  await page.locator('#osArchiveRows').filter({hasText:'P0 Historico QA encerrado'}).waitFor({state:'visible'});
  await page.screenshot({path:path.join(outputDir,'07-p0-historico-filtrado.png'),fullPage:true});
  await page.locator('#osArchiveRows .os-card').first().click();
  await page.locator('#modalBody').filter({hasText:'Ações da OS'}).waitFor({state:'visible'});
  await page.locator('#modalClose').click();

  await page.locator('[data-page="sales"]').click();
  await page.locator('#openCash').waitFor({state:'visible'});
  await page.locator('#openCash').click();
  await page.locator('#modalBody input[name="opening"]').fill('50');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#closeCash').waitFor({state:'visible'});
  await page.locator('#closeCash').click();
  const counted=page.locator('#modalBody input[name="closing"]');
  await counted.waitFor({state:'visible'});
  if(await counted.inputValue()!=='')throw new Error('P0: caixa abriu com contagem preenchida automaticamente');
  await page.screenshot({path:path.join(outputDir,'08-p0-contagem-caixa.png'),fullPage:true});
  await counted.fill('40');
  await page.locator('#modalBody button[type="submit"]').click();
  await page.locator('#openCash').waitFor({state:'visible'});
  const lastCash=(await qaRequest('/api/cash/sessions'))[0];
  if(lastCash.status!=='FECHADO'||lastCash.difference_cents!==-1000)throw new Error('P0: divergência de caixa incorreta: '+JSON.stringify(lastCash));
  await page.screenshot({path:path.join(outputDir,'09-p0-caixa-fechado.png'),fullPage:true});

  for(const role of ['FINANCEIRO','TECNICO','ATENDIMENTO']){
    const username='p0qa-'+role.toLowerCase();
    const password='P0QA!2026abc';
    await qaRequest('/api/users','POST',{username,password,role,name:'QA '+role});
    const roleContext=await browser.newContext({viewport});
    const rolePage=await roleContext.newPage();
    try{
      await rolePage.goto('http://127.0.0.1:3344',{waitUntil:'domcontentloaded'});
      await rolePage.locator('#loginForm input[name="username"]').fill(username);
      await rolePage.locator('#loginForm input[name="password"]').fill(password);
      await rolePage.locator('#loginForm button[type="submit"]').click();
      await rolePage.locator('#appView').waitFor({state:'visible'});
      await rolePage.locator('[data-page="customers"]').click();
      await rolePage.locator('#content').filter({hasText:'Clientes cadastrados'}).waitFor({state:'visible'});
      if((await rolePage.locator('#newCustomer').count())!==(role==='ATENDIMENTO'?1:0))throw new Error('P0: permissão de clientes divergente para '+role);
      await rolePage.locator('[data-page="inventory"]').click();
      await rolePage.locator('#content').filter({hasText:'Movimentações auditáveis'}).waitFor({state:'visible'});
      if((await rolePage.locator('#newPart').count())!==(role==='ATENDIMENTO'?1:0))throw new Error('P0: permissão de estoque divergente para '+role);
      await rolePage.locator('[data-page="work-orders"]').click();
      await rolePage.locator('#osArchiveStatus').waitFor({state:'visible'});
      if((await rolePage.locator('#newOS').count())!==(role==='ATENDIMENTO'?1:0))throw new Error('P0: abertura de OS divergente para '+role);
      await rolePage.locator('.os-card').first().click();
      await rolePage.locator('#modalBody').filter({hasText:'Ações da OS'}).waitFor({state:'visible'});
      if((await rolePage.locator('#editFullOS').count())!==(role==='FINANCEIRO'?0:1))throw new Error('P0: edição de OS divergente para '+role);
      if(role==='FINANCEIRO'){
        if(await rolePage.locator('#quoteBtn, #submitQuote, #partBtn, #checkBtn, #photoBtn').count())throw new Error('P0: financeiro recebeu ação operacional sem autorização');
        const readonly=await rolePage.locator('#diagnosisForm textarea').getAttribute('readonly');
        if(readonly===null)throw new Error('P0: diagnóstico editável para financeiro');
      }
      await rolePage.locator('#modalClose').click();
      const roleToken=await rolePage.evaluate(()=>localStorage.getItem('oficina_token'));
      if(role!=='ATENDIMENTO'){
        const forbidden=await fetch('http://127.0.0.1:3344/api/customers',{
          method:'POST',headers:{Authorization:'Bearer '+roleToken,'Content-Type':'application/json'},
          body:JSON.stringify({name:'Proibido QA'})
        });
        if(forbidden.ok)throw new Error('P0: API permitiu criar cliente ao perfil '+role);
      }
      await rolePage.screenshot({path:path.join(outputDir,'10-p0-perfil-'+role.toLowerCase()+'.png'),fullPage:true});
    }finally{await roleContext.close()}
  }

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

  await writeFile(path.join(outputDir,'qa-summary.json'),`${JSON.stringify({status:'passed',viewport:viewportName,checks:['login','dashboard','demo-data','work-orders','os-detail','edit-action','pdf-action','history-action','client-save-without-rerender','settings-draft-focus-preserved','vehicle-identity','review-and-warranty','first-run-admin-browser','p0-archive-search','p0-cash-counted','p0-cash-difference','p0-role-ui-matrix','p0-role-api-authorization']},null,2)}\n`);
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
