const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('WindowAPI', {
  isElectron: true,
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),
})