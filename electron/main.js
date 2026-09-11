import { app, BrowserWindow, dialog, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
let server = null;
let db = null;
let serverUrl = null;

function dataRoot() {
  const local = process.env.LOCALAPPDATA || app.getPath('userData');
  return join(local, 'ArtiSys', 'OficinaAgro');
}

async function startLocalServer() {
  const root = dataRoot();
  const dbPath = join(root, 'data', 'oficina.sqlite');
  const storageDir = join(root, 'storage', 'uploads');

  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(storageDir, { recursive: true });

  process.env.DATABASE_PATH = dbPath;
  process.env.STORAGE_DIR = storageDir;
  process.env.HOST = '0.0.0.0';
  process.env.PORT = '3333';

  // Em builds Electron empacotados, process.argv[1] pode vir undefined.
  // server.js usa esse argumento apenas para detectar execução direta;
  // fornecemos um caminho válido antes do import para evitar ERR_INVALID_ARG_TYPE.
  if (!process.argv[1]) process.argv[1] = fileURLToPath(import.meta.url);

  const [{ openDatabase }, { seed }, { createAppServer }] = await Promise.all([
    import('../dist/src/db.js'),
    import('../dist/src/seed.js'),
    import('../dist/src/server.js'),
  ]);

  db = openDatabase(dbPath);
  seed(db);
  server = createAppServer({ db, storageDir });

  const port = Number(process.env.PORT || 3333);
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError);
      resolve();
    });
  });

  // A janela desktop usa loopback; tablets/celulares usam o IP LAN do PC na porta 3333.
  serverUrl = `http://127.0.0.1:${port}`;
  return serverUrl;
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
  const url = await startLocalServer();
  createWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createWindow(serverUrl);
  });
}).catch((error) => {
  console.error(error);
  dialog.showErrorBox('Oficina Agro', `Falha ao iniciar o aplicativo:\n\n${error?.stack || error}`);
  app.quit();
});

app.on('before-quit', () => {
  try { server?.close(); } catch {}
  try { db?.close(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
