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
  await page.getByLabel('Usuário').fill('admin');
  await page.getByLabel('Senha').fill('Admin@1234');
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

  await writeFile(path.join(outputDir,'qa-summary.json'),`${JSON.stringify({status:'passed',viewport:viewportName,checks:['login','dashboard','demo-data','work-orders','os-detail','edit-action','pdf-action','history-action']},null,2)}\n`);
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
