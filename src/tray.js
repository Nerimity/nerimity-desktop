const { Tray, Menu, app } = require("electron");
const { getMainWindow } = require("./mainWindow");
const { icon } = require("./icon");

/**
 * @type { Tray }
 */
let tray = null;

const contextMenu = () => {
  return Menu.buildFromTemplate([
    {
      label: 'Show App', click: function () {
        getMainWindow()?.show()
      }
    },
    {
      label: 'Quit', click: function () {
        getMainWindow()?.close()
        getMainWindow()?.destroy()
        app.quit();
      }
    }
  ]);
}

function setTray() {
  tray = new Tray(icon);
  tray.setToolTip('Nerimity');
  tray.setContextMenu(contextMenu())
  tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", () => {
    getMainWindow()?.show();
  })
  return tray;
}
module.exports = {
  setTray,
  getTray: () => tray,
}