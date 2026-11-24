import { app, BrowserWindow, session } from "electron";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { openMainWindow, getMainWindow } from "./mainWindow.js";
import { setTray, getTray, toggleWindow } from "./tray.js";
import { isPacked } from "./utils.js";
import { openUpdaterWindow } from "./updaterWindow.js";

// AppImage and Flatpak builds use different userData directories, so the
// Electron lock alone does not prevent two instances when both are installed.
const instanceLockFile = join(
  process.env.FLATPAK_ID ? join("/home", process.env.USER || "user") : homedir(),
  ".config",
  "nerimity-instance.lock",
);

function acquireSharedLock() {
  try {
    if (existsSync(instanceLockFile)) {
      const pid = parseInt(readFileSync(instanceLockFile, "utf8").trim(), 10);
      if (pid && pid !== process.pid) {
        process.kill(pid, 0);
        return false;
      }
    }
  } catch (_) {
    // Stale lock file: take ownership.
  }
  try {
    writeFileSync(instanceLockFile, String(process.pid));
  } catch (error) {
    console.error("Could not write the instance lock:", error);
  }
  return true;
}

function releaseSharedLock() {
  try {
    if (parseInt(readFileSync(instanceLockFile, "utf8").trim(), 10) === process.pid) {
      unlinkSync(instanceLockFile);
    }
  } catch (_) {}
}

const singleInstanceLock =
  app.requestSingleInstanceLock() && acquireSharedLock();

app.setAppUserModelId("nerimity.com");

const isWayland =
  Boolean(process.env.WAYLAND_DISPLAY) ||
  process.env.XDG_SESSION_TYPE === "wayland";
if (isWayland) app.commandLine.appendSwitch("ozone-platform", "wayland");
else if (process.env.DISPLAY) app.commandLine.appendSwitch("ozone-platform", "x11");
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");
app.commandLine.appendSwitch("disk-cache-size", String(512 * 1024 * 1024));

app.on("second-instance", () => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    openMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function onReady() {
  if (!singleInstanceLock) {
    app.quit();
    return;
  }
  // The site uses the Electron token for bot detection on some flows.
  session.defaultSession.setUserAgent(
    session.defaultSession.getUserAgent().replace(/\sElectron\/[\d.]+/, ""),
  );

  // Short cache for metadata only; never cache message content.
  const metadataFilter = {
    urls: [
      "*://nerimity.com/api/*",
      "*://*.nerimity.com/api/*",
      "*://cdn.nerimity.com/*",
    ],
  };
  session.defaultSession.webRequest.onHeadersReceived(
    metadataFilter,
    (details, callback) => {
      const headers = details.responseHeaders || {};
      const url = details.url || "";
      const isMetadata = /\/channels(\/|\?|$)|\/servers(\/|\?|$)|\/users(\/|\?|$)|\/inbox(\/|\?|$)|\/friends(\/|\?|$)/i.test(
        url,
      );
      const isMessageContent = /\/messages(\/|\?|$)|\/posts(\/|\?|$)|\/typing(\/|\?|$)|\/read(\/|\?|$)/i.test(
        url,
      );
      if (
        details.method === "GET" &&
        !isMessageContent &&
        (isMetadata || url.includes("cdn.nerimity.com"))
      ) {
        for (const key of Object.keys(headers)) {
          if (/^cache-control$/i.test(key) || /^pragma$/i.test(key) || /^expires$/i.test(key)) {
            delete headers[key];
          }
        }
        headers["Cache-Control"] = [
          "private, max-age=120, stale-while-revalidate=600",
        ];
      }
      callback({ responseHeaders: headers });
    },
  );

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
  // Keep the app alive in the tray; use the tray's Quit item to exit.
  if (process.platform !== "darwin" && !getTray()) {
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  releaseSharedLock();
});

app.on("activate", () => {
  if (getMainWindow()) toggleWindow();
  else openMainWindow();
});
