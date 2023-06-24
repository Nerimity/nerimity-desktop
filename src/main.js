const { app, BrowserWindow } = require("electron");

app.whenReady().then(onReady)

/**
 * @type { BrowserWindow }
 */
let win = null;


function onReady() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    center: true,
    frame: false,
  })

  win.loadURL("https://nerimity.com");
}