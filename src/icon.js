const { nativeImage } = require("electron");
const path = require("path");

const iconPath = path.join(__dirname, '../build/icon.ico');
const notificationIconPath = path.join(__dirname, '../build/notification_icon.ico');

const icon = nativeImage.createFromPath(iconPath);
const notificationIcon = nativeImage.createFromPath(notificationIconPath);


function setIcon(window, tray, icon) {
  window && window.setIcon(icon)
  tray && tray.setImage(icon)
}

module.exports = {
  icon, 
  notificationIcon,
  setIcon
}