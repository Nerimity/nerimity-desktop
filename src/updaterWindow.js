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

function openUpdaterWindow() {
  updaterWindow = new BrowserWindow({
    width: 300,
    height: 350,
    center: true,
    frame: false,
    show: !startupMinimized,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, "preloaders", "updaterPreloader.js"),
    },
  });

  updaterWindow.webContents.ipc.on("ready", () => {
    autoUpdater.checkForUpdates();

    autoUpdater.on("update-not-available", () => {
      autoUpdater.removeAllListeners();
      mainWindow.openMainWindow();
      updaterWindow.close();
    });
    autoUpdater.on("error", (err) => {
      autoUpdater.removeAllListeners();
      mainWindow.openMainWindow();
      dialog.showErrorBox("Error", err.stack);
      updaterWindow.close();
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
