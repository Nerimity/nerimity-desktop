import { BrowserWindow, dialog } from "electron";
import electronUpdater from "electron-updater";
import { join } from "path";
import { appIcon } from "./icon.js";
import * as mainWindow from "./mainWindow.js";
const args = process.argv;
const startupMinimized = args.includes("--hidden");

const __dirname = import.meta.dirname;

const { autoUpdater } = electronUpdater;

/**
 * @type { BrowserWindow }
 */
let updaterWindow = null;
let retryCount = 0;
function openUpdaterWindow() {
  updaterWindow = new BrowserWindow({
    width: 300,
    height: 350,
    center: true,
    frame: false,
    show: !startupMinimized,
    backgroundColor: "#131416",
    resizable: false,
    maximizable: false,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, "preloaders", "updaterPreloader.js"),
    },
  });

  updaterWindow.webContents.ipc.on("ready", () => {
    autoUpdater.checkForUpdates();

    autoUpdater.on("download-progress", (progressObj) => {
      updaterWindow.webContents.send("download-progress", progressObj);
    })

    autoUpdater.on("update-not-available", () => {
      autoUpdater.removeAllListeners();
      mainWindow.openMainWindow();
      updaterWindow.close();
    });

    autoUpdater.on("error", (err) => {

      if (retryCount >= 5) {
        autoUpdater.removeAllListeners();
        mainWindow.openMainWindow();
        dialog.showErrorBox("Error", err.stack);
        updaterWindow.close();
        return;
      }
      updaterWindow.webContents.send("error");
      
      setTimeout(() => {
        retryCount++;
        autoUpdater.checkForUpdates();
      }, 5000);
    });


    autoUpdater.on("update-available", (progressObj) => {
      updaterWindow.webContents.send("updating");
    });

    autoUpdater.on("update-downloaded", (info) => {
      autoUpdater.quitAndInstall();
    });
  });
  updaterWindow.loadFile(join(__dirname, "views", "updater.html"));
}
export const getUpdaterWindow = () => updaterWindow;
export { openUpdaterWindow };
