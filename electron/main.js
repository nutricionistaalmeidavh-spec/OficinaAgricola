import { app, BrowserWindow, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../dist/src/db.js';
import { seed } from '../dist/src/seed.js';
import { createAppServer } from '../dist/src/server.js';

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
  process.env.HOST = '127.0.0.1';

  db = openDatabase(dbPath);
  seed(db);
  server = createAppServer({ db, storageDir });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Falha ao iniciar servidor local');
  serverUrl = `http://127.0.0.1:${address.port}`;
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
  app.quit();
});

app.on('before-quit', () => {
  try { server?.close(); } catch {}
  try { db?.close(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
