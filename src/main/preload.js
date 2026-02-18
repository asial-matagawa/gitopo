const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitopo', {
  git: {
    exec: (args) => ipcRenderer.invoke('git:exec', args),
  },
});
