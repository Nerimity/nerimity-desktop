const { app, BrowserWindow } = require("electron");
const path = require("path");
const store = require("./store");

app.whenReady().then(onReady)

/**
 * @type { BrowserWindow }
 */
let win = null;


function onReady() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    center: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  })

  win.webContents.ipc.on("window-minimize", () => win.minimize())
  win.webContents.ipc.on("window-close", () => win.close())

  win.webContents.ipc.handle("get-autostart", (event) => store.getAutostart())
  win.webContents.ipc.on("set-autostart", (event, value) => store.setAutostart(value))

  win.webContents.ipc.on("window-toggle-maximize", () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  })

  win.loadURL("http://localhost:3000/login");
  // win.loadURL("https://nerimity.com");
}