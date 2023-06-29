const path = require("path");
const process = require("process");

function isPacked() {
  const execFile = path.basename(process.execPath).toLowerCase()
  if (process.platform === 'win32') {
    return execFile !== 'electron.exe'
  }
  return execFile !== 'electron'
}

module.exports = {isPacked};