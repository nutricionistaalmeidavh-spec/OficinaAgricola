const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oficinaUpdates', {
  status: () => ipcRenderer.invoke('oficina:update-status'),
  check: () => ipcRenderer.invoke('oficina:check-update')
});
contextBridge.exposeInMainWorld('oficinaPrinter', {
  printDocument: html => ipcRenderer.invoke('oficina:print-document', html)
});
