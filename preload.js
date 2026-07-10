const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claude', {
  onUsageUpdate: (callback) => {
    ipcRenderer.on('usage-update', (_, data) => callback(data));
  },
  refresh: () => ipcRenderer.invoke('refresh'),
  close: () => ipcRenderer.invoke('close'),
  minimize: () => ipcRenderer.invoke('minimize'),
});
