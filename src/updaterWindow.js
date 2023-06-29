const { BrowserWindow, dialog } = require("electron")
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { icon, } = require("./icon");
const mainWindow = require("./mainWindow");
const args = process.argv;
const startupMinimized = args.includes('--hidden')

/**
 * @type { BrowserWindow }
 */
let updaterWindow = null;

function openUpdaterWindow() {
  updaterWindow = new BrowserWindow({
    width: 300,
    height: 350,
    center: true,
    frame: false,
    show: !startupMinimized,
    icon: icon,
    webPreferences: {
      preload: path.join(__dirname, "preloaders", 'updaterPreloader.js'),
    }
  })

  updaterWindow.webContents.ipc.on("ready", () => {
    autoUpdater.checkForUpdates();

    autoUpdater.on("update-not-available", () => {
      autoUpdater.removeAllListeners()
      mainWindow.openMainWindow();
      updaterWindow.close();
    })
    autoUpdater.on("error", (err) => {
      autoUpdater.removeAllListeners()
      mainWindow.openMainWindow();
      dialog.showErrorBox("Error", err.stack);
      updaterWindow.close();
    })
    autoUpdater.on('update-available', (progressObj) => {
      updaterWindow.webContents.send('updating');
    })
    autoUpdater.on('update-downloaded', (info) => {
      autoUpdater.quitAndInstall();
    })
  })
  updaterWindow.loadFile(path.join(__dirname, "views", "updater.html"));
}

module.exports = {
  openUpdaterWindow,
  getUpdaterWindow: () => updaterWindow,
};