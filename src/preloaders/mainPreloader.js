const { contextBridge, ipcRenderer, webContents } = require("electron");

contextBridge.exposeInMainWorld("WindowAPI", {
  isElectron: true,
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),

  getAutostart: () => ipcRenderer.invoke("get-autostart"),
  setAutostart: (value) => ipcRenderer.send("set-autostart", value),

  getHardwareAccelerationDisabled: () => ipcRenderer.invoke("get-hw-acceleration-disabled"),
  setHardwareAccelerationDisabled: (value) => ipcRenderer.send("set-hw-acceleration-disabled", value),

  getAutostartMinimized: () => ipcRenderer.invoke("get-autostart-minimized"),
  setAutostartMinimized: (value) =>
    ipcRenderer.send("set-autostart-minimized", value),

  setNotification: (value) => ipcRenderer.send("set-notification", value),

  getDesktopCaptureSources: () =>
    ipcRenderer.invoke("get-desktop-capture-sources"),

  setDesktopCaptureSourceId: (id) =>
    ipcRenderer.invoke("set-desktop-capture-source-id", id),

  getRunningPrograms: (ignoredPrograms) =>
    ipcRenderer.invoke("get-running-programs", ignoredPrograms),

  restartActivityStatus: (listeningPrograms) =>
    ipcRenderer.send("restart-activity-status", listeningPrograms),
  restartRPCServer: () => ipcRenderer.send("restart-rpc-server"),
  rpcChanged: (callback) =>
    ipcRenderer.on("rpc-changed", (event, val) => callback(val)),

  activityStatusChanged: (callback) =>
    ipcRenderer.on("activity-status-changed", (event, val) => callback(val)),
  
  onGlobalKey: (callback) =>
    ipcRenderer.on("global-key", (event, val) => callback(val)),

  startGlobalKeyListener: () =>
    ipcRenderer.send("start-global-key-listener"),

  stopGlobalKeyListener: () =>
    ipcRenderer.send("stop-global-key-listener"),

  relaunchApp: () => ipcRenderer.send("relaunch-app"),

  replaceMisspelling: (word) => ipcRenderer.send("replace-misspelling", word),

  onSpellcheck: (callback) =>
    ipcRenderer.on("spellcheck", (event, val) => callback(val)),

  clipboardPaste: () => ipcRenderer.send("clipboard-actions", "paste"),
  clipboardCut: () => ipcRenderer.send("clipboard-actions", "cut"),
  clipboardCopy: () => ipcRenderer.send("clipboard-actions", "copy"),
});
