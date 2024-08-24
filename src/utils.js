import { basename } from "path";
import { execPath, platform } from "process";
import { BrowserWindow } from "electron";

import { getWindows, ProcessListener } from "@nerimity/active-window-listener";
import { WebSocketRPCServer } from "./rpc/WebSocket.js";
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
  const windows = getWindows();

  let programs = [];

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];

    const filename = window.path.split("\\").at(-1);
    if (!filename) continue;

    if (storedPrograms.find((sp) => sp.filename === filename)) continue;

    let title;
    const exif = await window.getExif()?.catch(() => {});
    if (!exif) title = window.getTitle();
    else if (exif.FileDescription && exif.FileDescription.trim().length) {
      title = exif.FileDescription;
    } else if (exif.ProductName && exif.ProductName.trim().length) {
      title = exif.ProductName;
    }

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
  processListener = new ProcessListener(programNameArr);
  processListener.on("change", (window) => {
    if (rpcServer?.RPCs?.length) return;
    handleWindow(window, browserWindow);
  });
}

function handleWindow(window, browserWindow) {
  if (!window)
    return browserWindow.webContents.send("activity-status-changed", false);
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
    handleRPC(rpcServer.RPCs[0]?.data, browserWindow);
    return;
  }

  rpcServer = new WebSocketRPCServer(userToken, isPacked());
  rpcServer.serve();
  rpcServer.on("RPC_UPDATE", (data) => {
    handleRPC(data, browserWindow);
  });
}
async function stopRPCServer() {
  rpcServer.destroy();
  rpcServer = undefined;
}

function handleRPC(data, browserWindow) {
  if (!data) return browserWindow.webContents.send("rpc-changed", false);
  browserWindow.webContents.send("rpc-changed", data);
}

export {
  isPacked,
  getAllRunningPrograms,
  startActivityListener,
  startRPCServer,
  stopRPCServer,
};
