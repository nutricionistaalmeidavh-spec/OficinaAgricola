// The document has already been read by the authenticated OS screen.
export async function printDocument(BrowserWindow, parent, html) {
  const printer = new BrowserWindow({
    parent, show: false, autoHideMenuBar: true,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      javascript: false, partition: 'oficina-print'
    }
  });
  try {
    const contents = printer.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'file://*/*'] },
      (_details, callback) => callback({ cancel: true })
    );
    await contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await new Promise((resolve, reject) => {
      printer.once('closed', () => resolve({ cancelled: true }));
      contents.print({ silent: false, printBackground: true, pageSize: 'A4' }, (success, reason) => {
        if (success) resolve({ cancelled: false });
        else if (/cancel/i.test(reason)) resolve({ cancelled: true });
        else reject(new Error(reason || 'O Windows não conseguiu iniciar a impressão.'));
      });
    });
  } finally {
    if (!printer.isDestroyed()) printer.destroy();
  }
}
