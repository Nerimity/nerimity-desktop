const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('WindowAPI', {
  isElectron: true,
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),

  getAutostart: (key) => ipcRenderer.invoke('get-autostart'),
  setAutostart: (value) => ipcRenderer.send('set-autostart', value)

})