const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('WindowAPI', {
  ready: () => ipcRenderer.send("ready"),
  updating: (e) => ipcRenderer.on("updating", e),
  error: (e) => ipcRenderer.on("error", e)
})