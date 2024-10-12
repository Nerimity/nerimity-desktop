const { contextBridge, ipcRenderer, webContents } = require("electron");

contextBridge.exposeInMainWorld("WindowAPI", {
  isElectron: true,
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),

  getAutostart: () => ipcRenderer.invoke("get-autostart"),
  setAutostart: (value) => ipcRenderer.send("set-autostart", value),

  getAutostartMinimized: () => ipcRenderer.invoke("get-autostart-minimized"),
  setAutostartMinimized: (value) =>
    ipcRenderer.send("set-autostart-minimized", value),

  setNotification: (value) => ipcRenderer.send("set-notification", value),

  getDesktopCaptureSources: () =>
    ipcRenderer.invoke("get-desktop-capture-sources"),

  setDesktopCaptureSourceId: (id) =>
    ipcRenderer.send("set-desktop-capture-source-id", id),

  getRunningPrograms: (ignoredPrograms) =>
    ipcRenderer.invoke("get-running-programs", ignoredPrograms),

  restartActivityStatus: (listeningPrograms) =>
    ipcRenderer.send("restart-activity-status", listeningPrograms),
  restartRPCServer: () => ipcRenderer.send("restart-rpc-server"),
  rpcChanged: (callback) =>
    ipcRenderer.on("rpc-changed", (event, val) => callback(val)),

  activityStatusChanged: (callback) =>
    ipcRenderer.on("activity-status-changed", (event, val) => callback(val)),

  relaunchApp: () => ipcRenderer.send("relaunch-app"),

  replaceMisspelling: (word) => ipcRenderer.send("replace-misspelling", word),

  onSpellcheck: (callback) =>
    ipcRenderer.on("spellcheck", (event, val) => callback(val)),

  clipboardPaste: () => ipcRenderer.send("clipboard-actions", "paste"),
  clipboardCut: () => ipcRenderer.send("clipboard-actions", "cut"),
  clipboardCopy: () => ipcRenderer.send("clipboard-actions", "copy"),
});
