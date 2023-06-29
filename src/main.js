const { app, BrowserWindow } = require("electron");
const { openMainWindow, getMainWindow } = require("./mainWindow");
const { setTray, getTray } = require("./tray");
const { isPacked } = require("./utils");
const { openUpdaterWindow } = require("./updaterWindow");

const singleInstanceLock = app.requestSingleInstanceLock()

app.on('second-instance', (event, argv, cwd) => {
  if (!getMainWindow()) return;
  getMainWindow().show();
  if (getMainWindow().isMinimized()) getMainWindow().restore();
  getMainWindow().focus();
})

function onReady() {
  if (!singleInstanceLock){
    app.quit();
    return;
  }
  setTray();
  if (isPacked()) {
    openUpdaterWindow();
  } else {
    openMainWindow();
  }
}
app.whenReady().then(onReady)

app.on('window-all-closed', () => {
  getTray().destroy();
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

