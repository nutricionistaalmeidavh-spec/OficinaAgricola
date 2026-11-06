import { app, BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {startDesktopUpdates} from './updater.js';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
let serverUrl = null;
let postgresController=null;
let postgresBackend=null;
let postgresShuttingDown=false;

function dataRoot() {
  const local = process.env.LOCALAPPDATA || app.getPath('userData');
  return join(local, 'ArtiSys', 'Oficina');
}

function commercialEditionRequired(){
  if(!app.isPackaged)return process.env.OFICINA_REQUIRE_COMMERCIAL_ACTIVATION==='true';
  // Marcador gerado explicitamente pelo empacotador. Não depende de variáveis
  // do computador do cliente; é false para o instalador gratuito.
  let edition;
  try{edition=JSON.parse(readFileSync(join(process.resourcesPath,'oficina-edition.json'),'utf8'));}
  catch{throw Error('Manifesto da edição do instalador ausente ou inválido');}
  if(edition.product!=='OFICINA'||typeof edition.commercialActivation!=='boolean')
    throw Error('Manifesto da edição do instalador incompatível');
  return edition.commercialActivation;
}

async function startPostgresDesktop(){
  if(process.platform!=='win32'||process.arch!=='x64'||!app.isPackaged)
    throw Error('Runtime PostgreSQL embarcado exige instalador Windows x64 validado');
  const root=dataRoot();
  const [{createPortablePostgresController},{Pool}]=await Promise.all([
    import('../dist/src/platform/postgres-local-instance.js'),
    import('pg')
  ]);
  postgresController=createPortablePostgresController({
    resourcesPath:process.resourcesPath,dataRoot:root,Pool
  });
  let config;
  try{
    // No terminal, global service, network download, or manual SQL setup:
    // initdb and pg_ctl are executed from read-only NSIS extraResources.
    // Configura automaticamente o ACBr no mesmo perfil do PostgreSQL.
    // Não existe caminho alternativo SQLite nem serviço pago obrigatório.
    const {configureBundledFiscal}=await import('../dist/src/platform/fiscal-bundle.js');
    const fiscal=configureBundledFiscal({
      resourcesPath:process.resourcesPath,dataRoot:root,
      platform:process.platform,arch:process.arch
    });
    console.info('[fiscal-bundle]',fiscal.active?'Pacote local verificado':'Pacote não ativo: '+fiscal.reason);
    config=await postgresController.ensureReady();
    const port=3344;
    const entry=join(app.getAppPath(),'dist','src','start-postgres-unified.js');
    const env={
      ...process.env,
      ELECTRON_RUN_AS_NODE:'1',
      OFICINA_POSTGRES_REGISTRY_URL:config.registryUrl,
      OFICINA_POSTGRES_OPERATIONS_URL:config.operationsUrl,
      OFICINA_POSTGRES_PORT:String(port),
      OFICINA_POSTGRES_STORAGE_ROOT:join(root,'storage','postgres'),
      OFICINA_POSTGRES_PROVISION_NEW_UNITS:'true',
      OFICINA_POSTGRES_MANAGED_LOCAL:'true',
      OFICINA_BUNDLED_FISCAL_VERIFIED:fiscal.active?'true':'false',
      OFICINA_REGISTRY_NEW_INSTALL:config.newInstall?'true':'false'
    };
    postgresBackend=spawn(process.execPath,[entry],{
      env,windowsHide:true,stdio:['ignore','ignore','pipe']
    });
    let exited=false;
    postgresBackend.once('exit',()=>{exited=true;});
    postgresBackend.once('error',()=>{exited=true;});
    postgresBackend.stderr.on('data',()=>{ /* Do not log private connection details. */ });
    serverUrl='http://127.0.0.1:'+port;
    for(let attempt=0;attempt<100;attempt++){
      if(exited)throw Error('Backend PostgreSQL encerrado durante inicialização');
      try{
        const response=await fetch(serverUrl+'/api/health',{signal:AbortSignal.timeout(900)});
        const state=await response.json();
        if(response.ok&&state.ok&&state.engine==='postgres'&&state.operationalApiReady===true)
          return serverUrl;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    throw Error('Backend PostgreSQL não respondeu no endereço local reservado');
  }catch(error){
    postgresBackend?.kill();
    await postgresController.stop().catch(()=>{});
    throw error;
  }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7f5',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Web Serial: seleção explícita de adaptador e somente na origem local do app.
  const ses=mainWindow.webContents.session;
  ses.setPermissionCheckHandler((contents,permission,requestingOrigin)=>
    permission==='serial' && contents===mainWindow?.webContents &&
    requestingOrigin===new URL(url).origin);
  ses.on('select-serial-port',(event,ports,contents,callback)=>{
    event.preventDefault();
    if(contents!==mainWindow?.webContents||!ports.length){callback('');return}
    dialog.showMessageBox(mainWindow,{
      title:'Adaptador OBD-II',message:'Selecione a porta serial do adaptador ELM327',
      type:'question',buttons:['Cancelar',...ports.map((p,i)=>p.displayName||('Porta '+(i+1)))],
      defaultId:0,cancelId:0
    }).then(({response})=>callback(response?ports[response-1]?.portId||'':''))
      .catch(()=>callback(''));
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target) && !target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });

  mainWindow.loadURL(url);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  const root = dataRoot();
  app.setPath('userData', join(root, 'electron'));
  const url = await startPostgresDesktop();
  createWindow(url);
  startDesktopUpdates({getWindow:()=>mainWindow,isCommercial:commercialEditionRequired()});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createWindow(serverUrl);
  });
}).catch((error) => {
  console.error(error);
  dialog.showErrorBox('ArtiSys Oficina', `Falha ao iniciar o aplicativo:\n\n${error?.stack || error}`);
  app.quit();
});

app.on('before-quit', (event) => {
  if(postgresController&&!postgresShuttingDown){
    event.preventDefault();
    postgresShuttingDown=true;
    void (async()=>{
      postgresBackend?.kill('SIGTERM');
      await postgresController.stop();
    })().catch(()=>{}).finally(()=>app.quit());
    return;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
