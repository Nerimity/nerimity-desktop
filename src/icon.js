import { type, platform } from "os";
import { join } from "path";
import { nativeImage } from "electron";
import { count } from "console";

const __dirname = import.meta.dirname;

let iconPath;
let notificationIconPath;
let windowsOverlayIconPath = join(
  __dirname,
  "../build/windows_overlay_notification.png"
);

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
const windowsOverlayIcon = nativeImage.createFromPath(windowsOverlayIconPath);

const notificationCountIcons = Array.from({ length: 10 }, (_, index) => {
  if (index === 0) return windowsOverlayIcon;
  return nativeImage.createFromPath(
    join(__dirname, `../build/windows_overlay_notification_${index}.png`)
  );
});

/**
 *
 * @param {{window?: import("electron").BrowserWindow, tray?: import("electron").Tray, type: "NORMAL" | "NOTIFICATION", count?: number}} opts
 */
function setOverlayIcon(opts) {
  if (opts.type === "NORMAL") {
    opts.window.setOverlayIcon(null, "no_notification");
    return;
  }

  console.log(opts.count);
  const icon = notificationCountIcons[opts.count > 9 ? 9 : opts.count];
  opts.window.setOverlayIcon(icon, "notification");
}

/**
 *
 * @param {{window?: import("electron").BrowserWindow, tray?: import("electron").Tray, type: "NORMAL" | "NOTIFICATION", count?: number}} opts
 */
function setAppIcon(opts) {
  console.log(opts.count);
  const iconMap = {
    NORMAL: appIcon,
    NOTIFICATION: appNotificationIcon,
  };

  const icon = iconMap[opts.type];

  if (type == "Windows_NT") {
    setOverlayIcon(opts);
  } else {
    opts.window?.setIcon(icon);
  }
  opts.tray?.setImage(icon);
}

export { appIcon, setAppIcon };
