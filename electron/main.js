import { app, BrowserWindow, dialog, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
let server = null;
let db = null;
let serverUrl = null;
let eventRuntime = null;
let outboxTimer = null;
let stopBackupSchedule=null;
let postgresController=null;
let postgresBackend=null;
let postgresShuttingDown=false;

function dataRoot() {
  const local = process.env.LOCALAPPDATA || app.getPath('userData');
  return join(local, 'ArtiSys', 'Oficina');
}

async function startLocalServer() {
  const root = dataRoot();

  if (!process.argv[1]) process.argv[1] = fileURLToPath(import.meta.url);

  const [
    {openDatabase,migrate},{seed},{migrateAssistencia},{createAssistenciaServer},
    {createEventRuntime},{dispatchOutbox},{recoverOrphanAttachments},{startBackupSchedule}
  ]=await Promise.all([
    import('../dist/src/db.js'),
    import('../dist/src/seed.js'),
    import('../dist/src/assistencia-schema.js'),
    import('../dist/src/server-assistencia.js'),
    import('../dist/src/platform/event-runtime.js'),
    import('../dist/src/platform/outbox.js'),
    import('../dist/src/services/operations.js'),
    import('../dist/src/platform/backup-scheduler.js'),
  ]);
  // Identidade nova: nenhuma busca por pastas ou bancos de versões antigas.
  const dbPath = join(root, 'data', 'artisys-oficina.sqlite');
  const storageDir = join(root, 'storage', 'uploads');
  mkdirSync(join(root,'data'),{recursive:true});
  mkdirSync(storageDir,{recursive:true});
  process.env.DATABASE_PATH=dbPath;
  process.env.STORAGE_DIR=storageDir;
  process.env.HOST='127.0.0.1';
  process.env.PORT='3344';

  db = openDatabase(dbPath);
  migrate(db);
  migrateAssistencia(db);
  seed(db);
  // Fiscal Windows integrado: DLLs + worker no diretório somente-leitura do instalador;
  // arquivos de configuração, certificado e INI sempre fora do pacote, no perfil local.
  // Na primeira instalação o módulo permanece desabilitado em fiscal_settings.
  if(app.isPackaged){
    const {configureBundledFiscal}=await import('../dist/src/platform/fiscal-bundle.js');
    const fiscal=configureBundledFiscal({
      resourcesPath:process.resourcesPath,dataRoot:root,platform:process.platform,arch:process.arch
    });
    console.info('[fiscal-bundle]',fiscal.active?'Pacote local verificado':'Pacote não ativo: '+fiscal.reason);
  }
  // Paridade com src/start.js: eventos são persistidos e recuperados no desktop.
  recoverOrphanAttachments(db,storageDir);
  eventRuntime=createEventRuntime({auditPath:join(root,'events','events.jsonl')});
  server = createAssistenciaServer({ db, storageDir, eventRuntime });
  stopBackupSchedule=startBackupSchedule({
    databasePath:dbPath,uploadsPath:storageDir,
    backupRoot:join(root,'backups'),retention:7
  });

  const port = Number(process.env.PORT || 3344);
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  const flushEvents=()=>void dispatchOutbox(db,eventRuntime)
    .catch(error=>console.error('[desktop-outbox]',error?.message||String(error)));
  flushEvents();
  outboxTimer=setInterval(flushEvents,15000);
  outboxTimer.unref?.();

  serverUrl = `http://127.0.0.1:${port}`;
  return serverUrl;
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
  const url = process.env.OFICINA_POSTGRES_DESKTOP_MODE==='enabled'
    ?await startPostgresDesktop():await startLocalServer();
  createWindow(url);

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
  stopBackupSchedule?.();
  if(outboxTimer)clearInterval(outboxTimer);
  try { server?.close(); } catch {}
  try { eventRuntime?.close(); } catch {}
  try { db?.close(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
