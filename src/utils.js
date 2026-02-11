import { basename, resolve } from "path";
import { execPath, platform } from "process";
import { BrowserWindow } from "electron";

import {
  getWindows,
  ProcessListener,
  ProcessListenerLinux,
  getLinuxWindows,
} from "@nerimity/active-window-listener";
import { WebSocketRPCServer } from "./rpc/WebSocket.js";
import { ProcessMonitor } from "./rpc/ProcessMonitor.js";
import os from "os";
import {
  getActiveWindowProcessIds,
  startAudioCapture,
  setExecutablesRoot,
  stopAudioCapture,
} from "application-loopback";
import { getMainWindow } from "./mainWindow.js";

const isLinux = os.type() === "Linux";

/**
 * Checks if the application is packed or not.
 *
 * @return {boolean} Returns true if the application is packed, false otherwise.
 */
function isPacked() {
  const execFile = basename(execPath).toLowerCase();
  if (platform === "win32") {
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
  if (isLinux) {
    const windows = getLinuxWindows();

    let programs = [];
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];

      const filename = window.owner?.path?.split("/").at(-1);
      if (!filename) continue;

      if (storedPrograms.find((sp) => sp.filename === filename)) continue;

      let title;
      if (window.owner.name) {
        title = window.owner.name;
      } else if (window.title) {
        title = window.title;
      }
      if (!title) continue;
      programs.push({ name: title, filename, path: window.owner.path });
    }
    return programs.filter((obj, index) => {
      return programs.findIndex((obj2) => obj.path === obj2.path) === index;
    });
  }

  const windows = getWindows();

  let programs = [];

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];

    const filename = window.path.split("\\").at(-1);
    if (!filename) continue;

    if (storedPrograms.find((sp) => sp.filename === filename)) continue;

    let title = window.getTitle();
    const exif = await window.getExif()?.catch(() => {});
    if (exif.FileDescription && exif.FileDescription.trim().length) {
      title = exif.FileDescription;
    } else if (exif.ProductName && exif.ProductName.trim().length) {
      title = exif.ProductName;
    }

    console.log(window.getTitle(), title);
    if (!title) continue;

    programs.push({ name: title, filename });
  }

  return programs;
}

/**
 * @type {WebSocketRPCServer | undefined}
 */
let rpcServer;

/**
 * @type {ProcessMonitor | undefined}
 */
let processMonitor;

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
  const programNameArr = listenToPrograms.map((p) => p.filename);
  if (processListener) {
    if (rpcServer?.RPCs?.length) return;
    processListener.updateExecutableFilenames(programNameArr);
    handleWindow(processListener.lastActiveWindow(), browserWindow);
    return;
  }

  processListener = new (isLinux ? ProcessListenerLinux : ProcessListener)(
    programNameArr
  );
  processListener.on("change", (window) => {
    if (rpcServer?.RPCs?.length) return;
    handleWindow(window, browserWindow);
  });
}

function handleWindow(window, browserWindow) {
  if (!window)
    return browserWindow.webContents.send("activity-status-changed", false);

  if (isLinux) {
    browserWindow.webContents.send("activity-status-changed", {
      filename: window.owner?.path?.split("/").at(-1),
      createdAt: window.createdAt,
    });

    return;
  }

  browserWindow.webContents.send("activity-status-changed", {
    filename: window.path.split("\\")[window.path.split("\\").length - 1],
    createdAt: window.createdAt,
  });
}

const PROCESS_MONITOR_RPC_ID = "wayland_game_monitor";

/**
 *
 * @param {BrowserWindow} browserWindow
 */
async function startRPCServer(browserWindow, userToken) {
  if (rpcServer) {
    rpcServer.destroy();
  }

  rpcServer = new WebSocketRPCServer(userToken, isPacked());
  rpcServer.serve();
  rpcServer.on("RPC_UPDATE", (data) => {
    handleRPC(data, browserWindow);
  });

  // Start the Wayland-compatible process monitor for game detection, if better implimentation possible, do so UwU
  if (processMonitor) {
    processMonitor.stop();
  }
  
  processMonitor = new ProcessMonitor();
  
  processMonitor.on("game_detected", (rpcData) => {
    console.log("Game detected by ProcessMonitor:", rpcData);
    rpcServer.updateRPC(PROCESS_MONITOR_RPC_ID, rpcData);
  });
  
  processMonitor.on("game_closed", () => {
    console.log("Game closed, removing RPC");
    rpcServer.removeRPC(PROCESS_MONITOR_RPC_ID);
  });
  
  processMonitor.start();
}

async function stopRPCServer() {
  if (processMonitor) {
    processMonitor.stop();
    processMonitor = undefined;
  }
  
  if (rpcServer) {
    rpcServer.destroy();
    rpcServer = undefined;
  }
}

function handleRPC(data, browserWindow) {
  if (!data) return browserWindow.webContents.send("rpc-changed", false);
  browserWindow.webContents.send("rpc-changed", data);
}

const createAppLoopback = () => {
  if (isPacked()) {
    setExecutablesRoot(
      resolve(
        import.meta.dirname,
        "..",
        "..",
        "app.asar.unpacked",
        "node_modules",
        "application-loopback",
        "bin"
      )
    );
  }

  /**
   *
   * @param {number} hwnd
   */
  const hwndToProcessId = async (hwnd) => {
    const windows = await getActiveWindowProcessIds();
    return windows.find((w) => w.hwnd === hwnd)?.processId;
  };

  /**
   * @type {number | null}
   */
  let processId = null;

  /**
   *
   * @param {string} chromeMediaSourceId
   */
  const startCapture = async (chromeMediaSourceId) => {
    reset();
    const hwnd = chromeMediaSourceId.split(":")[1];
    console.log("AppLoopback: hwnd", hwnd);
    processId = await hwndToProcessId(hwnd);
    if (!processId) {
      console.log("AppLoopback: processId not found");
    }
    console.log("AppLoopback: processId", processId);
    startAudioCapture(processId, {
      onData: (d) => {
        getMainWindow()?.webContents.send("app-loopback-data", d);
      },
    });
  };

  const reset = () => {
    if (!processId) return;
    stopAudioCapture(processId);
    processId = null;
  };

  return {
    startCapture,
    reset,
  };
};

export {
  isPacked,
  getAllRunningPrograms,
  startActivityListener,
  startRPCServer,
  stopRPCServer,
  createAppLoopback,
};
