const { app, BrowserWindow, session } = require("electron");
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


  const filter = {
    urls: ['https://drive.usercontent.google.com/*', 'https://drive.google.com/*']
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (details.requestHeaders) {
      delete details.requestHeaders["Sec-Fetch-Mode"];
      delete details.requestHeaders["Sec-Fetch-Site"];
      delete details.requestHeaders["Sec-Ch-Ua"];
      delete details.requestHeaders["Sec-Ch-Ua-Mobile"];
      delete details.requestHeaders["Sec-Ch-Ua-Platform"];
      delete details.requestHeaders["Sec-Fetch-Dest"];
      delete details.requestHeaders["Origin"];
    } 
    callback({requestHeaders: details.requestHeaders})
  })

session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
  if (details.responseHeaders) {
    if (!details.url.startsWith("https://drive.usercontent.google.com")) {
      details.responseHeaders["Access-Control-Allow-Origin"] = ['*'];
    } else {
    }
    delete details.responseHeaders["Origin"];
  }

  callback({ responseHeaders: details.responseHeaders });
});



}
app.whenReady().then(onReady)

app.on('window-all-closed', () => {
  getTray().destroy();
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

