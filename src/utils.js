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
import { DiscordBridge } from "./rpc/DiscordBridge.js";
import os from "os";

import { getMainWindow } from "./mainWindow.js";
import timers from "timers/promises";
// import loopback from 'loopback-capture';


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
    const exif = await window.getExif()?.catch(() => { });
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
 * @type {DiscordBridge | undefined}
 */
let discordBridge;

/**
 * Latest activity list captured from the Discord IPC bridge.
 * @type {Array<{id: string, data: Record<string, any>}>}
 */
let bridgeRPCs = [];

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
    processListener.updateExecutableFilenames(programNameArr);
    handleWindow(processListener.lastActiveWindow(), browserWindow);
    return;
  }

  processListener = new (isLinux ? ProcessListenerLinux : ProcessListener)(
    programNameArr,
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

/**
 *
 * @param {BrowserWindow} browserWindow
 */
async function startRPCServer(browserWindow, userToken) {
  if (rpcServer) {
    // added timeout to connect faster.
    // todo: must reset rpc extension port back to index 0 when successfully connected and then disconnected.
    await timers.setTimeout(4000);
    rpcServer.destroy();
  }

  rpcServer = new WebSocketRPCServer(userToken, isPacked());
  rpcServer.serve();
  rpcServer.on("RPC_UPDATE", () => {
    emitRPC(browserWindow);
  });
}
async function stopRPCServer() {
  rpcServer.destroy();
  rpcServer = undefined;
}

/**
 * Sends the merged activity list (extension RPCs + Discord IPC bridge) to the
 * page. Either side changing re-sends the whole list so neither can clobber
 * the other. Skipped while the page is still loading; the caller re-emits on
 * did-finish-load.
 *
 * @param {BrowserWindow} browserWindow
 */
function emitRPC(browserWindow) {
  const contents = browserWindow?.webContents;
  if (!contents || contents.isDestroyed() || contents.isLoading()) return;
  contents.send("rpc-changed", [...(rpcServer?.RPCs ?? []), ...bridgeRPCs]);
}

/**
 * Starts capturing rich presence that apps send to Discord's local IPC
 * endpoint while Discord itself is closed.
 *
 * @param {BrowserWindow} browserWindow
 */
function startDiscordBridge(browserWindow) {
  if (discordBridge) return;
  const bridge = new DiscordBridge();
  bridge.on("update", (rpcs) => {
    bridgeRPCs = rpcs;
    emitRPC(browserWindow);
  });
  discordBridge = bridge;
  bridge.start().catch(() => {});
}

function stopDiscordBridge() {
  if (!discordBridge) return;
  const bridge = discordBridge;
  discordBridge = undefined;
  // stop() emits an empty update, which clears bridge entries from the page.
  bridge.stop();
  bridge.removeAllListeners();
}




/**
 * @type {import("loopback-capture").LoopbackCapture | null}
 */
let loopbackCapture = null;



const createAppLoopback = () => {

  /**
   *
   * @param {number} hwnd
   */
  const hwndToProcessId = async (hwnd) => {
    const windows = await getWindows();
    return windows.find((w) => w.id.toString() === hwnd)?.processId;
  };

  /**
   * @type {number | null}
   */
  let processId = null;

  /**
   *
   * @param {{
   *  type: "CaptureApp",
   *  chromeMediaSourceId: string;
   * } | 
   * {
   *  type: "CaptureSystem",
   *  excludeSelf: boolean 
   * }} opts
   */
  const startCapture = async (opts) => {
    const loopback = await (await import("loopback-capture")).default
    reset();


    if (opts.type === "CaptureApp") {
      const hwnd = opts.chromeMediaSourceId.split(":")[1];
      console.log("AppLoopback: hwnd", hwnd);
      processId = await hwndToProcessId(hwnd);
      if (!processId) {
        console.log("AppLoopback: processId not found");
      }
      console.log("AppLoopback: processId", processId);


      loopbackCapture = new loopback.LoopbackCapture();
      loopbackCapture.start(processId, true, onLoopbackData);
    }

    if (opts.type === "CaptureSystem") {
      if (!opts.excludeSelf) {
        loopbackCapture = new loopback.LoopbackCapture();
        loopbackCapture.startSystemAudio(onLoopbackData)
      }

      if (opts.excludeSelf) {
        const selfProcessId = process.pid;
        loopbackCapture = new loopback.LoopbackCapture();
        loopbackCapture.start(selfProcessId, false, onLoopbackData);
      }
    }
  };

  const onLoopbackData = (chunk) => {
    getMainWindow()?.webContents.send("app-loopback-data", chunk);
  }


  const reset = () => {
    loopbackCapture?.stop();
    if (!processId) return;
    processId = null;
    loopbackCapture = null;
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
  emitRPC,
  startDiscordBridge,
  stopDiscordBridge,
  createAppLoopback,
};
