const { contextBridge, ipcRenderer  } = require('electron')

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

  getRunningPrograms: (ignoredPrograms) => ipcRenderer.invoke('get-running-programs', ignoredPrograms),


  restartActivityStatus: (listeningPrograms) => ipcRenderer.send('restart-activity-status', listeningPrograms),

  activityStatusChanged: (callback) => ipcRenderer.on('activity-status-changed', (event, val) => callback(val)),


})