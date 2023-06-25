const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('WindowAPI', {
  isElectron: true
})