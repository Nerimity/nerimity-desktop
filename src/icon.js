const os = require("os");
const path = require("path");
const {nativeImage,} = require("electron");

let iconPath;
let notificationIconPath;

if (os.type == 'Windows_NT') {
    iconPath = path.join(__dirname, '../build/icon.ico');
    notificationIconPath = path.join(__dirname, '../build/notification_icon.ico');
} else {
    iconPath = path.join(__dirname, '../build/icon.png');
    notificationIconPath = path.join(__dirname, '../build/notification_icon.png');
}

const appIcon = nativeImage.createFromPath(iconPath);
const appNotificationIcon = nativeImage.createFromPath(notificationIconPath);


/**
 *
* @param {{window?: import("electron").BrowserWindow, tray?: import("electron").Tray, type: "NORMAL" | "NOTIFICATION"}} opts
 */
function setAppIcon(opts) {

    const iconMap = {
        "NORMAL": appIcon,
        "NOTIFICATION": appNotificationIcon
    }

    const icon = iconMap[opts.type]
    
    opts.window?.setIcon(icon)
    opts.tray?.setImage(icon)

}

module.exports = {
    appIcon,
    setAppIcon
    
}