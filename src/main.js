const { app, BrowserWindow } = require("electron");
const { openMainWindow, getMainWindow } = require("./mainWindow");
const { setTray, getTray } = require("./tray");

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
  openMainWindow();
}
app.whenReady().then(onReady)

app.on('window-all-closed', () => {
  getTray().destroy();
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

