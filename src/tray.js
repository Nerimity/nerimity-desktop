import { Tray, Menu, app, shell } from "electron";
import { appIcon } from "./icon.js";

/**
 * @type { Tray }
 */
let tray = null;

async function getMainWindow() {
  const { getMainWindow: getWindow } = await import("./mainWindow.js");
  return getWindow();
}

async function toggleWindow() {
  const mainWindow = await getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const contextMenu = async () => {
  return Menu.buildFromTemplate([
    {
      label: "Show / Hide",
      click: () => toggleWindow(),
    },
    { type: "separator" },
    {
      label: "Reload",
      click: async () => {
        const mainWindow = await getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.reload();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "Open in browser",
      click: () => shell.openExternal("https://nerimity.com"),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: async () => {
        app.isQuitting = true;
        const mainWindow = await getMainWindow();
        mainWindow?.destroy();
        app.quit();
      },
    },
  ]);
};

async function setTray() {
  tray = new Tray(appIcon);
  tray.setToolTip("Nerimity");
  tray.setContextMenu(await contextMenu());
  tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", () => toggleWindow());
  return tray;
}
export const getTray = () => tray;
export { setTray, toggleWindow };
