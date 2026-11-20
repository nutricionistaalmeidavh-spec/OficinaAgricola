const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oficinaPrinter', {
  printDocument: html => ipcRenderer.invoke('oficina:print-document', html)
});
