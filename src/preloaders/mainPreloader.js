const { contextBridge, ipcRenderer, desktopCapturer  } = require('electron')

contextBridge.exposeInMainWorld('WindowAPI', {
  isElectron: true,
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),
  
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (value) => ipcRenderer.send('set-autostart', value),
  
  getAutostartMinimized: () => ipcRenderer.invoke('get-autostart-minimized'),
  setAutostartMinimized: (value) => ipcRenderer.send('set-autostart-minimized', value),
  
  setNotification: (value) => ipcRenderer.send('set-notification', value),
  
  getDesktopCaptureSources: () => ipcRenderer.invoke('get-desktop-capture-sources'),
})