import { type, platform } from "os";
import { join } from "path";
import { nativeImage } from "electron";

const __dirname = import.meta.dirname;

let iconPath;
let notificationIconPath;

if (type == "Windows_NT") {
  iconPath = join(__dirname, "../build/icon.ico");
  notificationIconPath = join(__dirname, "../build/notification_icon.ico");
} else if (platform() === "darwin") {
  iconPath = join(__dirname, "../build/icon-512.png");
  notificationIconPath = join(__dirname, "../build/notification_icon.png");
} else {
  iconPath = join(__dirname, "../build/icon.png");
  notificationIconPath = join(__dirname, "../build/notification_icon.png");
}

const appIcon = nativeImage.createFromPath(iconPath);
const appNotificationIcon = nativeImage.createFromPath(notificationIconPath);

/**
 *
 * @param {{window?: import("electron").BrowserWindow, tray?: import("electron").Tray, type: "NORMAL" | "NOTIFICATION"}} opts
 */
function setAppIcon(opts) {
  const iconMap = {
    NORMAL: appIcon,
    NOTIFICATION: appNotificationIcon,
  };

  const icon = iconMap[opts.type];

  opts.window?.setIcon(icon);
  opts.tray?.setImage(icon);
}

export { appIcon, setAppIcon };
