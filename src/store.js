import Store from "electron-store";
const store = new Store();

export function get(value) {
  return store.get(value);
}
export function setAutostart(value) {
  return store.set("autostart", value);
}
export function setAutostartMinimized(value) {
  return store.set("autostartMinimized", value);
}
export function getAutostart() {
  return store.get("autostart", true);
}
export function getAutostartMinimized() {
  return store.get("autostartMinimized", true);
}

export function getHardwareAccelerationDisabled() {
  return store.get("hardwareAccelerationDisabled", false);
}

export function setHardwareAccelerationDisabled(value) {
  return store.set("hardwareAccelerationDisabled", value);
}

export function getCustomTitlebarDisabled() {
  return store.get("customTitlebarDisabled", false);
}

export function setCustomTitlebarDisabled(value) {
  return store.set("customTitlebarDisabled", value);
}
