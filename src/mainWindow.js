import { BrowserWindow, app, shell, desktopCapturer } from "electron";
import { join, basename } from "path";
import {
  getAutostart,
  setAutostart,
  getAutostartMinimized,
  setAutostartMinimized,
  getHardwareAccelerationDisabled,
  setHardwareAccelerationDisabled,
} from "./store.js";
import { setAppIcon, appIcon } from "./icon.js";
import { getTray } from "./tray.js";
import {
  isPacked,
  getAllRunningPrograms,
  startActivityListener,
  startRPCServer,
  stopRPCServer,
} from "./utils.js";
import {GlobalKeyboardListener} from "node-global-key-listener";

const args = process.argv;
const startupMinimized = args.includes("--hidden");

if (getHardwareAccelerationDisabled()) {
  app.disableHardwareAcceleration();
}

const __dirname = import.meta.dirname;

/**
 * @type { BrowserWindow }
 */
let mainWindow = null;
/**
 * @type { Electron.DesktopCapturerSource[] | null }
 */
let desktopCaptureSources = null;
/**
 * @type { Electron.DesktopCapturerSource | null }
 */
let desktopCaptureSource = null;


/**
 * @type { GlobalKeyboardListener | null }
 */
let globalKeyboard = null;
let downKeys = new Set();
async function openMainWindow() {
  setStartup();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    center: true,
    frame: false,
    show: !startupMinimized,
    icon: appIcon,
    backgroundColor: "#131416",
    webPreferences: {
      webSecurity: isPacked(),
      spellcheck: true,
      preload: join(__dirname, "preloaders", "mainPreloader.js"),
    },
  });

  const sess = mainWindow.webContents.session;

  sess.setDisplayMediaRequestHandler(async (request, callback) => {
    callback({ video: desktopCaptureSource, audio: request.audioRequested ? "loopback" : undefined });
    desktopCaptureSource = null;
    desktopCaptureSources = null;
  });

  mainWindow.webContents.ipc.on("relaunch-app", () => {
    stopRPCServer();
    app.relaunch();
    app.exit();
  });
  mainWindow.webContents.ipc.on("window-minimize", () => mainWindow.minimize());
  mainWindow.webContents.ipc.on("window-close", () => mainWindow.hide());

  mainWindow.webContents.ipc.handle("get-autostart", (event) => getAutostart());
  mainWindow.webContents.ipc.on("set-autostart", (event, value) => {
    setAutostart(value);
    setStartup();
  });


  mainWindow.webContents.ipc.handle("get-hw-acceleration-disabled", (event) => getHardwareAccelerationDisabled());
  mainWindow.webContents.ipc.on("set-hw-acceleration-disabled", (event, value) => {
    setHardwareAccelerationDisabled(value);
  });

  mainWindow.webContents.ipc.handle("get-autostart-minimized", (event) =>
    getAutostartMinimized()
  );
  mainWindow.webContents.ipc.on("set-autostart-minimized", (event, value) => {
    setAutostartMinimized(value);
    setStartup();
  });

  const sendKey = (e, down) => {
    mainWindow.webContents.send("global-key", { down, event: e });
  };

  mainWindow.webContents.ipc.on("start-global-key-listener", () => {
    if (globalKeyboard)  {
      globalKeyboard.kill();
      downKeys.clear();
      globalKeyboard = null;
    }
    globalKeyboard = new GlobalKeyboardListener();
    globalKeyboard.addListener(function (e, down) {
      if (e.state === "DOWN") {
        if (!downKeys.has(e.vKey)){
          sendKey(e, down)
        }
        downKeys.add(e.vKey);
      } else {
        sendKey(e, down)
        downKeys.delete(e.vKey);
      }

    });
  });
  mainWindow.webContents.ipc.on("stop-global-key-listener", () => {
    if (!globalKeyboard) return;
    globalKeyboard.kill();
    downKeys.clear();
    globalKeyboard = null;
  });


  mainWindow.webContents.ipc.on("window-toggle-maximize", () => {
    if (mainWindow.isMaximized()) return mainWindow.unmaximize();
    mainWindow.maximize();
  });
  mainWindow.webContents.ipc.on("set-notification", (event, value) => {
    setAppIcon({
      window: mainWindow,
      tray: getTray(),
      type: value ? "NOTIFICATION" : "NORMAL",
    });
  });

  let didLoadSuccess = false;
  mainWindow.webContents.on("did-navigate", () => {
    didLoadSuccess = true;
  })
  mainWindow.webContents.on("did-fail-load", function() {
    if (didLoadSuccess) return;
    console.log("Failed to load, retrying... in 5 seconds");

    setTimeout(async() => {
      if (!isPacked()) {
        await mainWindow.loadURL("http://localhost:3000/login");
      } else {
        await mainWindow.loadURL("https://nerimity.com/login");
      }
    }, 5000);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  mainWindow.webContents.ipc.handle(
    "get-desktop-capture-sources",
    async (event) => {
      desktopCaptureSource = null;
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { height: 400, width: 400 },
      });
      desktopCaptureSources = sources;
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnailUrl: source.thumbnail.toDataURL(),
      }));
    }
  );

  mainWindow.webContents.ipc.handle(
    "set-desktop-capture-source-id",
    async (event, id) => {
      desktopCaptureSource = desktopCaptureSources.find(
        (source) => source.id === id
      );
      return true;
    }
  );

  mainWindow.webContents.ipc.handle(
    "get-running-programs",
    async (event, ignoredPrograms = []) => {
      return await getAllRunningPrograms(ignoredPrograms);
    }
  );

  if (!isPacked()) {
    await mainWindow.loadURL("http://localhost:3000/login");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadURL("https://nerimity.com/login");
  }

  const userToken = await getUserToken();

  mainWindow.webContents.ipc.on("replace-misspelling", (event, word) => {
    mainWindow.webContents.replaceMisspelling(word);
  });
  mainWindow.webContents.ipc.on(
    "restart-activity-status",
    (event, listenToPrograms = []) => {
      startActivityListener(listenToPrograms, mainWindow);
    }
  );
  mainWindow.webContents.ipc.on("restart-rpc-server", () => {
    startRPCServer(mainWindow, userToken);
  });

  mainWindow.on("close", function (event) {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
  mainWindow.webContents.ipc.on("clipboard-actions", (event, action) => {
    if (action === "copy") {
      mainWindow.webContents.copy();
    }
    if (action === "cut") {
      mainWindow.webContents.cut();
    }
    if (action === "paste") {
      mainWindow.webContents.paste();
    }
  });

  mainWindow.webContents.on("context-menu", (event, params) => {
    mainWindow.webContents.send("spellcheck", params.dictionarySuggestions);
  });
}

const getUserToken = async () => {
  const token = await mainWindow.webContents.executeJavaScript(
    'localStorage.getItem("userToken");',
    true
  );
  return token;
};

export const getMainWindow = () => mainWindow;
export { openMainWindow, getUserToken };

function setStartup() {
  if (!isPacked()) return;
  const autostartEnabled = getAutostart();
  const autostartMinimized = getAutostartMinimized();
  const appPath = app.getPath("exe");
  const name = basename(appPath);
  app.setLoginItemSettings({
    enabled: autostartEnabled,
    openAtLogin: autostartEnabled,
    openAsHidden: autostartMinimized,
    appPath,
    args: [
      "--processStart",
      `"${name}"`,
      "--process-start-args",
      autostartMinimized ? `"--hidden"` : "",
    ],
  });
}
