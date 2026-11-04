// QA real: login, escolha do Fiat Uno, download verificado, visualização Three.js 360°.
// Testado em desktop e celular, sem mocks de WebGL ou imagens de outros carros.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';

const viewportName=process.argv[2]||'desktop';
const viewport=viewportName==='mobile'?{width:390,height:844}:{width:1440,height:900};
const port=3345;
const base='http://127.0.0.1:'+port;
const output=path.resolve(process.argv[3]||'qa-artifacts-models3d-'+viewportName);
await mkdir(output,{recursive:true});
const log=[];
const child=spawn(process.execPath,['src/start.js'],{
  env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATABASE_PATH:'.qa3d/oficina.sqlite',STORAGE_DIR:'.qa3d/uploads',EVENT_LOG_PATH:'.qa3d/events.jsonl',NODE_ENV:'development'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>log.push(d.toString()));
child.stderr.on('data',d=>log.push(d.toString()));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitHealth(){
  for(let i=0;i<120;i++){
    try{if((await fetch(base+'/api/health')).ok)return}catch{}
    await sleep(250);
  }
  throw new Error('Servidor QA não iniciou');
}
let browser=null,context=null,page=null;
const browserErrors=[];
try{
  await waitHealth();
  browser=await chromium.launch({headless:true,args:[
    '--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
    '--enable-unsafe-swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage'
  ]});
  context=await browser.newContext({viewport});
  page=await context.newPage();
  page.on('pageerror',e=>browserErrors.push(String(e.message||e)));
  page.on('response',r=>{if(r.status()>=400&&r.url().includes('/vendor/'))browserErrors.push('HTTP '+r.status()+' '+r.url())});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#loginForm input[name="username"]').fill('admin');
  await page.locator('#loginForm input[name="password"]').fill('Admin@1234');
  await page.getByRole('button',{name:'Entrar'}).click();
  await page.locator('#appView').waitFor({state:'visible'});
  if(viewportName==='mobile'){
    await page.locator('#mobileMoreBtn').click();
    await page.locator('[data-mobile-page="model-library"]').click();
  }else{
    await page.locator('#nav [data-page="model-library"]').click();
  }
  await page.locator('#ml-grid .ml-card').first().waitFor({state:'visible'});
  if(await page.locator('#ml-grid .ml-card').count()!==20)throw new Error('Top20 não foi exibido');
  await page.screenshot({path:path.join(output,'01-top20.png'),fullPage:true});
  await page.locator('.ml-card[data-model-id="fiat-uno"] [data-model-detail]').click();
  await page.locator('#modalBody #ml-variant').waitFor({state:'visible'});
  await page.locator('#ml-variant').selectOption('restored');
  const ready=await page.locator('#ml-view-start').isEnabled();
  if(!ready){
    await page.locator('#ml-install').click();
    await page.waitForFunction(()=>document.querySelector('#ml-view-start')?.disabled===false,{timeout:120000});
  }
  await page.locator('#ml-view-start').click();
  await page.locator('#ml-viewer-stage canvas').waitFor({state:'visible',timeout:45000});
  await page.locator('#ml-viewer-message').filter({hasText:'Arraste para girar'}).waitFor({state:'visible',timeout:45000});
  if(browserErrors.length)throw new Error('Erros do visualizador: '+browserErrors.join(' | ').slice(0,1600));
  const canvas=page.locator('#ml-viewer-stage canvas');
  const dim=await canvas.evaluate(el=>({width:el.width,height:el.height}));
  if(dim.width<200||dim.height<200)throw new Error('Canvas 3D muito pequeno: '+JSON.stringify(dim));
  const rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width*.52,rect.y+rect.height*.48);
  await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.75,rect.y+rect.height*.45,{steps:8});
  await page.mouse.up();
  await page.screenshot({path:path.join(output,'02-uno-3d-360.png'),fullPage:true});
  if(viewportName==='desktop'){
    await page.locator('#ml-paint').fill('#2B5C8A');
    await page.screenshot({path:path.join(output,'03-uno-pintura-experimental.png'),fullPage:true});
  }
  await page.locator('#modalClose').click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#appView').waitFor({state:'visible'});
  // O servidor local continua com GLB instalado mesmo após recarregar o navegador.
  const response=await page.request.get(base+'/api/models3d/status',{
    headers:{Cookie:(await context.cookies()).filter(c=>c.name==='oficina_session').map(c=>c.name+'='+c.value).join('; ')}
  });
  if(!response.ok())throw new Error('Status offline indisponível '+response.status());
  const data=await response.json();
  if(!data.models.some(x=>x.id==='fiat-uno'&&x.installed.restored))
    throw new Error('GLB não persistiu no servidor após reload');
  await writeFile(path.join(output,'qa.json'),JSON.stringify({
    viewport:viewportName,model:'fiat-uno',variant:'restored',renderer:'Three.js WebGL',
    persisted:true,canvas:dim,errors:browserErrors
  },null,2));
  console.log('QA_GLTF_SUCCESS',viewportName,JSON.stringify(dim));
}catch(err){
  const viewerMessage=await page?.locator('#ml-viewer-message').textContent().catch(()=>null);
  const modalVisible=await page?.locator('#modal').isVisible().catch(()=>null);
  console.error('QA_GLTF_DEBUG',JSON.stringify({viewerMessage,modalVisible,browserErrors}));
  await page?.screenshot({path:path.join(output,'FAIL-viewer.png'),fullPage:true}).catch(()=>{});
  console.error('QA_GLTF_FAILED',String(err.stack||err));
  throw err;
}finally{
  await writeFile(path.join(output,'server.log'),log.join('').slice(-100000)).catch(()=>{});
  await context?.close().catch(()=>{});
  await browser?.close().catch(()=>{});
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(8000)]);
  if(child.exitCode==null)child.kill('SIGKILL');
}
