const Store = require('electron-store');
const store = new Store();

module.exports = {
  get: (value) => store.get(value),

  setAutostart:(value) => store.set("autostart", value),
  setAutostartMinimized:(value) => store.set("autostartMinimized", value),
  
  getAutostart:() => store.get("autostart", true),
  getAutostartMinimized:() => store.get("autostartMinimized", true),
};