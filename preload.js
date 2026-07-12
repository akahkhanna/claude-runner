const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claude', {
  onUsageUpdate: (callback) => {
    ipcRenderer.on('usage-update', (_, data) => callback(data));
  },
  refresh: () => ipcRenderer.invoke('refresh'),
  resize: (h) => ipcRenderer.invoke('resize', h),
  getStartup: () => ipcRenderer.invoke('get-startup'),
  setStartup: (on) => ipcRenderer.invoke('set-startup', on),
  close: () => ipcRenderer.invoke('close'),
  minimize: () => ipcRenderer.invoke('minimize'),
});
