const { app, BrowserWindow } = require("electron");
const path = require("path");

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadURL("http://localhost:3000/app");
  // win.loadURL("https://nerimity.com");
}