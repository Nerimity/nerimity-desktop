import { Tray, Menu, app } from "electron";
import { appIcon } from "./icon.js";

/**
 * @type { Tray }
 */
let tray = null;

const contextMenu = async () => {
  const { getMainWindow } = await import("./mainWindow.js");
  return Menu.buildFromTemplate([
    {
      label: "Show App",
      click: function () {
        getMainWindow()?.show();
      },
    },
    {
      label: "Quit",
      click: function () {
        app.isQuitting = true;
        getMainWindow()?.close();
        getMainWindow()?.destroy();
        app.quit();
      },
    },
  ]);
};

async function setTray() {
  const { getMainWindow } = await import("./mainWindow.js");
  tray = new Tray(appIcon);
  tray.setToolTip("Nerimity");
  tray.setContextMenu(await contextMenu());
  tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", () => {
    getMainWindow()?.show();
  });
  return tray;
}
export const getTray = () => tray;
export { setTray };
