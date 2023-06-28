const { BrowserWindow, app, shell } = require("electron")
const path = require("path");
const store = require("./store");
const { icon } = require("./icon");
const args = process.argv;
const startupMinimized = args.includes('--hidden')

/**
 * @type { BrowserWindow }
 */
let mainWindow = null;

function openMainWindow() {
  setStartup();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    center: true,
    frame: false,
    show: !startupMinimized,
    icon: icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  })

  mainWindow.webContents.ipc.on("window-minimize", () => mainWindow.minimize())
  mainWindow.webContents.ipc.on("window-close", () => mainWindow.hide())

  mainWindow.webContents.ipc.handle("get-autostart", (event) => store.getAutostart())
  mainWindow.webContents.ipc.on("set-autostart", (event, value) => store.setAutostart(value))

  mainWindow.webContents.ipc.handle("get-autostart-minimized", (event) => store.getAutostartMinimized())
  mainWindow.webContents.ipc.on("set-autostart-minimized", (event, value) => store.setAutostartMinimized(value))

  mainWindow.webContents.ipc.on("window-toggle-maximize", () => {
    if (mainWindow.isMaximized()) return mainWindow.unmaximize();   
    mainWindow.maximize();
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' }
  })

  mainWindow.loadURL("http://localhost:3000/login");
  // win.loadURL("https://nerimity.com");
}

module.exports = {
  openMainWindow,
  getMainWindow: () => mainWindow,
};

function setStartup() {
  const autostartEnabled = store.getAutostart()
  const autostartMinimized = store.getAutostartMinimized()
  const appPath = app.getPath("exe");
  const name = path.basename(appPath);
  app.setLoginItemSettings({
    enabled: autostartEnabled,
    openAtLogin: autostartEnabled,
    openAsHidden: autostartMinimized,
    appPath,
    args: [
      '--processStart', `"${name}"`,
      '--process-start-args', autostartMinimized ? `"--hidden"` : '',
    ],
  });
}