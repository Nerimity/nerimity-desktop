const { BrowserWindow, app, shell, desktopCapturer } = require("electron")
const path = require("path");
const store = require("./store");
const { setAppIcon, appIcon } = require("./icon");
const { getTray } = require("./tray");
const { isPacked, getAllRunningPrograms, startActivityListener, startRPCServer, stopRPCServer } = require("./utils");
const args = process.argv;
const startupMinimized = args.includes('--hidden')

/**
 * @type { BrowserWindow }
 */
let mainWindow = null;

async function openMainWindow() {
  setStartup();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    center: true,
    frame: false,
    show: !startupMinimized,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preloaders", 'mainPreloader.js'),
    }
  })

  mainWindow.webContents.ipc.on("relaunch-app", () => {
    stopRPCServer();
    app.relaunch()
    app.exit()
  })
  mainWindow.webContents.ipc.on("window-minimize", () => mainWindow.minimize())
  mainWindow.webContents.ipc.on("window-close", () => mainWindow.hide())

  mainWindow.webContents.ipc.handle("get-autostart", (event) => store.getAutostart())
  mainWindow.webContents.ipc.on("set-autostart", (event, value) => {
    store.setAutostart(value)
    setStartup();
  })
  
  mainWindow.webContents.ipc.handle("get-autostart-minimized", (event) => store.getAutostartMinimized())
  mainWindow.webContents.ipc.on("set-autostart-minimized", (event, value) => {
    store.setAutostartMinimized(value)
    setStartup();
  })
  
  mainWindow.webContents.ipc.on("window-toggle-maximize", () => {
    if (mainWindow.isMaximized()) return mainWindow.unmaximize();   
    mainWindow.maximize();
  })
  mainWindow.webContents.ipc.on("set-notification", (event, value) => {
    setAppIcon({
      window: mainWindow,
      tray: getTray(),
      type: value ? "NOTIFICATION" : "NORMAL"
    })
  })
  
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' }
  })

  mainWindow.webContents.ipc.handle("get-desktop-capture-sources", async (event) => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: {height: 400, width: 400}
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnailUrl: source.thumbnail.toDataURL()
    }));
  })

  mainWindow.webContents.ipc.handle("get-running-programs", async (event, ignoredPrograms = []) => {
    return await getAllRunningPrograms(ignoredPrograms)
  })


  if (!isPacked()) {
    await mainWindow.loadURL("http://localhost:3000/login");
    mainWindow.webContents.openDevTools({mode: 'detach'})
  } else {
    await mainWindow.loadURL("https://nerimity.com/login");
  }

  const userToken = await getUserToken();

  mainWindow.webContents.ipc.on("restart-activity-status",  (event, listenToPrograms = []) => {
    startActivityListener(listenToPrograms, mainWindow)
  })
  mainWindow.webContents.ipc.on("restart-rpc-server",  () => {
    startRPCServer(mainWindow, userToken)
  })

  mainWindow.on('close', function (event) {
    if(!app.isQuitting){
        event.preventDefault();
        mainWindow.hide();
    }
    return false;
  });






}

const getUserToken = async () => {
  const token =  await mainWindow.webContents
   .executeJavaScript('localStorage.getItem("userToken");', true);
   return token; 
}

module.exports = {
  openMainWindow,
  getMainWindow: () => mainWindow,
  getUserToken
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