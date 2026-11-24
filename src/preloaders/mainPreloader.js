const { contextBridge, ipcRenderer, webContents } = require("electron");

contextBridge.exposeInMainWorld("WindowAPI", {
  isElectron: true,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),

  getAutostart: () => ipcRenderer.invoke("get-autostart"),
  setAutostart: (value) => ipcRenderer.send("set-autostart", value),

  getHardwareAccelerationDisabled: () =>
    ipcRenderer.invoke("get-hw-acceleration-disabled"),
  setHardwareAccelerationDisabled: (value) =>
    ipcRenderer.send("set-hw-acceleration-disabled", value),

  getCustomTitlebarDisabled: () =>
    ipcRenderer.invoke("get-custom-titlebar-disabled"),
  setCustomTitlebarDisabled: (value) =>
    ipcRenderer.send("set-custom-titlebar-disabled", value),

  getAutostartMinimized: () => ipcRenderer.invoke("get-autostart-minimized"),
  setAutostartMinimized: (value) =>
    ipcRenderer.send("set-autostart-minimized", value),

  setNotification: (value, count) =>
    ipcRenderer.send("set-notification", value, count),

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

  startGlobalKeyListener: () => ipcRenderer.send("start-global-key-listener"),

  stopGlobalKeyListener: () => ipcRenderer.send("stop-global-key-listener"),

  relaunchApp: () => ipcRenderer.send("relaunch-app"),

  replaceMisspelling: (word) => ipcRenderer.send("replace-misspelling", word),

  onSpellcheck: (callback) =>
    ipcRenderer.on("spellcheck", (event, val) => callback(val)),

  clipboardPaste: () => ipcRenderer.send("clipboard-actions", "paste"),
  clipboardCut: () => ipcRenderer.send("clipboard-actions", "cut"),
  clipboardCopy: () => ipcRenderer.send("clipboard-actions", "copy"),

  appLoopbackStart: (captureSourceId) =>
    ipcRenderer.send("app-loopback-start", captureSourceId),

  appLoopbackStartV2: (opts) =>
    ipcRenderer.send("app-loopback-start-v2", opts),

  appLoopbackReset: () => ipcRenderer.send("app-loopback-reset"),
  appLoopbackData: (callback) =>
    ipcRenderer.on("app-loopback-data", (event, val) => callback(val)),

  // Text-to-speech for call messages (fully embedded, no Python required).
  getTtsSettings: () => ipcRenderer.invoke("get-tts-settings"),
  setTtsVoice: (voice) => ipcRenderer.send("set-tts-voice", voice),
  setTtsLocale: (locale) => ipcRenderer.send("set-tts-locale", locale),
  ttsSpeak: (payload) => ipcRenderer.invoke("tts-speak", payload),

  getScreenShareSettings: () => ipcRenderer.invoke("get-screen-share-settings"),
  setNativeScreenPicker: (value) =>
    ipcRenderer.send("set-native-screen-picker", value),
  setScreenShareAudioMode: (value) =>
    ipcRenderer.send("set-screen-share-audio-mode", value),

  listAudioApps: () => ipcRenderer.invoke("list-audio-apps"),
  startAudioAppCapture: (apps) =>
    ipcRenderer.invoke("start-audio-app-capture", apps),
  stopAudioAppCapture: () => ipcRenderer.invoke("stop-audio-app-capture"),
});

// Opt-in companion features used by the injected enhancements (TTS reader,
// call-chat tools and the application-audio picker). Kept separate from the
// WindowAPI contract shared with nerimity.com.
contextBridge.exposeInMainWorld("NeriExtras", {
  getSetting: (key, fallback) =>
    ipcRenderer.invoke("extra-get-setting", key, fallback),
  setSetting: (key, value) => ipcRenderer.send("extra-set-setting", key, value),

  chooseAudioFolder: () => ipcRenderer.invoke("extra-choose-folder"),
  listAudioFiles: (folder) => ipcRenderer.invoke("extra-list-audio-files", folder),
  readAudioFile: (filePath) => ipcRenderer.invoke("extra-read-audio-file", filePath),
  openSoundux: (folder) => ipcRenderer.invoke("extra-open-soundux", folder),

  ttsSpeak: (payload) => ipcRenderer.invoke("tts-speak", payload),

  venmicList: () => ipcRenderer.invoke("list-audio-apps"),
  venmicStart: (apps) => ipcRenderer.invoke("start-audio-app-capture", apps),
  venmicStop: () => ipcRenderer.invoke("stop-audio-app-capture"),
});
