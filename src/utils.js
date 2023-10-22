const path = require("path");
const process = require("process");
const {BrowserWindow} = require("electron")

const { getWindows, ProcessListener } = require("@nerimity/active-window-listener");

/**
 * Checks if the application is packed or not.
 *
 * @return {boolean} Returns true if the application is packed, false otherwise.
 */
function isPacked() {
  const execFile = path.basename(process.execPath).toLowerCase();
  if (process.platform === "win32") {
    return execFile !== "electron.exe";
  }
  return execFile !== "electron";
}

/**
 * Retrieves all running programs.
 *
 * @param {Array<{filename: string}>} storedPrograms - An array of stored programs (default: [])
 * @return {Promise<Array<{ name: string, filename: string}>>} An array of running programs
 */
async function getAllRunningPrograms(storedPrograms = []) {
  const windows = getWindows();

  let programs = [];

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];

    const filename = window.path.split("\\").at(-1);
    if (!filename) continue;

    if (storedPrograms.find((sp) => sp.filename === filename)) continue;

    let title;
    const exif = await window.getExif()?.catch(() => {});
    if (!exif) title = window.getTitle();
    else if (exif.FileDescription && exif.FileDescription.trim().length) {
      title = exif.FileDescription;
    } else if (exif.ProductName && exif.ProductName.trim().length) {
      title = exif.ProductName;
    }
    
    if (!title) continue;

    programs.push({ name: title, filename });
  }

  return programs;
};



/**
 * @type {ProcessListener | undefined}
 */
let processListener;

/**
 *
 * @param {Array<{filename: string}>} listenToPrograms - An array of programs to listen to (default: [])
 * @param {BrowserWindow} window
 */
async function startActivityListener(listenToPrograms = [], browserWindow) {
	const programNameArr = listenToPrograms.map(p => p.filename);
  if (processListener) {
    processListener.updateExecutableFilenames(programNameArr);
    handleWindow(processListener.lastActiveWindow(), browserWindow);
    return;
  }
	processListener = new ProcessListener(programNameArr);
	processListener.on("change", window => {
    handleWindow(window, browserWindow);
	})

};

function handleWindow(window, browserWindow) {
  if (!window) return browserWindow.webContents.send('activity-status-changed', false)
  browserWindow.webContents.send('activity-status-changed', {
    filename: window.path.split("\\")[window.path.split("\\").length - 1],
    createdAt: window.createdAt
  });
}

module.exports = { isPacked, getAllRunningPrograms, startActivityListener };
