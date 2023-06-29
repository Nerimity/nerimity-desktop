const { Tray, Menu, app } = require("electron");
const { icon } = require("./icon");

/**
 * @type { Tray }
 */
let tray = null;

const contextMenu = () => {
  const {getMainWindow} = require("./mainWindow");
  return Menu.buildFromTemplate([
    {
      label: 'Show App', click: function () {
        getMainWindow()?.show()
      }
    },
    {
      label: 'Quit', click: function () {
        app.isQuitting = true;
        getMainWindow()?.close()
        getMainWindow()?.destroy()
        app.quit();
      }
    }
  ]);
}

function setTray() {
  const {getMainWindow} = require("./mainWindow");
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