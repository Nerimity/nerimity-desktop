const { BrowserWindow, app, shell } = require("electron")
const path = require("path");
const store = require("./store");
const { icon, setIcon, notificationIcon } = require("./icon");
const { getTray } = require("./tray");
const { isPacked } = require("./utils");
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
      preload: path.join(__dirname, "preloaders", 'mainPreloader.js'),
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
  mainWindow.webContents.ipc.on("set-notification", (event, value) => {
    setIcon(mainWindow, getTray(), value ? notificationIcon : icon)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' }
  })

  mainWindow.on('close', function (event) {
    if(!app.isQuitting){
        event.preventDefault();
        mainWindow.hide();
    }
    return false;
  });

  if (!isPacked()) {
    mainWindow.loadURL("http://localhost:3000/login");
    mainWindow.webContents.openDevTools({mode: 'detach'})
  } else {
    mainWindow.loadURL("https://nerimity.com/login");
  }
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