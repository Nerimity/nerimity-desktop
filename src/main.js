import { app, BrowserWindow, session } from "electron";
import { openMainWindow, getMainWindow } from "./mainWindow.js";
import { setTray, getTray } from "./tray.js";
import { isPacked } from "./utils.js";
import { openUpdaterWindow } from "./updaterWindow.js";

const singleInstanceLock = app.requestSingleInstanceLock();

app.on("second-instance", (event, argv, cwd) => {
  if (!getMainWindow()) return;
  getMainWindow().show();
  if (getMainWindow().isMinimized()) getMainWindow().restore();
  getMainWindow().focus();
});

function onReady() {
  if (!singleInstanceLock) {
    app.quit();
    return;
  }
  // Skip tray on macOS (uses dock instead)
  if (process.platform !== "darwin") {
    setTray();
  }
  if (isPacked()) {
    openUpdaterWindow();
  } else {
    openMainWindow();
  }

  const filter = {
    urls: [
      "https://drive.usercontent.google.com/*",
      "https://drive.google.com/*",
    ],
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      if (details.requestHeaders) {
        delete details.requestHeaders["Sec-Fetch-Mode"];
        delete details.requestHeaders["Sec-Fetch-Site"];
        delete details.requestHeaders["Sec-Ch-Ua"];
        delete details.requestHeaders["Sec-Ch-Ua-Mobile"];
        delete details.requestHeaders["Sec-Ch-Ua-Platform"];
        delete details.requestHeaders["Sec-Fetch-Dest"];
        delete details.requestHeaders["Origin"];
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      if (details.responseHeaders) {
        if (!details.url.startsWith("https://drive.usercontent.google.com")) {
          details.responseHeaders["Access-Control-Allow-Origin"] = ["*"];
        } else {
        }
        delete details.responseHeaders["Origin"];
      }

      callback({ responseHeaders: details.responseHeaders });
    }
  );
}
app.whenReady().then(onReady);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    getTray()?.destroy();
    app.quit();
  }
});
