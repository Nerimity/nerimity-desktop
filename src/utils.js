import { basename, join, resolve } from "path";
import { existsSync } from "fs";
import { pathToFileURL } from "url";
import { execPath, platform } from "process";
import { spawn, spawnSync } from "child_process";
import { BrowserWindow } from "electron";

import {
  getWindows,
  ProcessListener,
  ProcessListenerLinux,
  getLinuxWindows,
} from "@nerimity/active-window-listener";
import { WebSocketRPCServer } from "./rpc/WebSocket.js";
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
  rpcServer.on("RPC_UPDATE", (data) => {
    handleRPC(data, browserWindow);
  });
}
async function stopRPCServer() {
  rpcServer.destroy();
  rpcServer = undefined;
}

function handleRPC(data, browserWindow) {
  browserWindow.webContents.send("rpc-changed", data);
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

/** @type {any | null | undefined} */
let venmicPatchBay;

/**
 * Load venmic lazily so the native addon is only required on Linux when the
 * user selects application audio for screen sharing.
 */
async function getVenmic() {
  if (venmicPatchBay !== undefined) return venmicPatchBay || null;
  venmicPatchBay = null;
  try {
    // Native prebuilds are unpacked from asar by electron-builder.
    const appRoot = resolve(import.meta.dirname, "..").replace(
      "app.asar",
      "app.asar.unpacked",
    );
    const prebuild = join(
      appRoot,
      "node_modules",
      "@vencord",
      "venmic",
      "prebuilds",
      `venmic-addon-linux-${platform}`,
      "node-napi-v7.node",
    );
    const mod = existsSync(prebuild)
      ? await import(pathToFileURL(prebuild).href)
      : await import("@vencord/venmic");
    const PatchBay = mod.PatchBay || mod.default?.PatchBay;
    if (PatchBay) venmicPatchBay = new PatchBay();
  } catch (error) {
    console.error("venmic could not be loaded:", error);
  }
  return venmicPatchBay || null;
}

/** List PipeWire output streams that can be shared as application audio. */
async function listPipeWireAudioApps() {
  try {
    const patchBay = await getVenmic();
    if (!patchBay) return { ok: false, error: "venmic unavailable", targets: [] };
    const targets = (
      patchBay.list([
        "application.name",
        "node.name",
        "media.class",
        "application.process.id",
      ]) || []
    )
      .filter(
        (target) =>
          String(target["application.process.id"] || "") !== String(process.pid),
      )
      .filter((target) => !/nerimity/i.test(String(target["application.name"] || "")));
    return { ok: true, targets };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
      targets: [],
    };
  }
}

/** Link selected applications into the shared screen-share audio stream. */
async function startPipeWireAudioCapture(include = []) {
  try {
    const patchBay = await getVenmic();
    if (!patchBay) return { ok: false, error: "venmic unavailable" };
    patchBay.link({
      include: Array.isArray(include) ? include : [],
      exclude: [
        { "application.process.id": process.pid },
        { "media.class": "Stream/Input/Audio" },
      ],
      ignore_devices: true,
      only_speakers: true,
      only_default_speakers: false,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function stopPipeWireAudioCapture() {
  try {
    (await getVenmic())?.unlink();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * Run a command on the host when the app is sandboxed by Flatpak.
 * @param {string[]} args
 * @returns {string[]}
 */
function hostArgs(args) {
  return process.env.FLATPAK_ID ? ["flatpak-spawn", "--host", ...args] : args;
}

/** Run a short-lived command and capture its output. */
function runOnHost(args, options = {}) {
  const command = hostArgs(args);
  return spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    timeout: 15000,
    ...options,
  });
}

/**
 * Play an MP3 buffer without writing it to a temporary file. The bytes are
 * piped through stdin, which also works when /tmp is private to the Flatpak
 * sandbox. Each available player is tried in order.
 *
 * @param {Buffer} buffer
 */
async function playAudioBuffer(buffer) {
  const candidates = [
    ["pw-play", ["-"]],
    ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "error", "-"]],
    ["mpv", ["--no-video", "--really-quiet", "-"]],
    ["paplay", []],
    ["aplay", []],
  ];
  let lastError = "no audio player available";
  for (const [cmd, args] of candidates) {
    const result = await new Promise((resolveResult) => {
      const command = hostArgs([cmd, ...args]);
      let child;
      try {
        child = spawn(command[0], command.slice(1), {
          stdio: ["pipe", "ignore", "pipe"],
        });
      } catch (error) {
        resolveResult({ ok: false, error: String(error.message || error) });
        return;
      }
      let stderr = "";
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_) {}
        resolveResult({ ok: false, error: `${cmd}: timeout` });
      }, 60000);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolveResult({ ok: false, error: String(error.message || error) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveResult(
          code === 0
            ? { ok: true, player: cmd }
            : {
                ok: false,
                error: (stderr || `${cmd} exited with ${code}`).slice(0, 200),
              },
        );
      });
      // Avoid EPIPE when the player exits before consuming all input.
      child.stdin?.on("error", () => {});
      try {
        child.stdin?.end(buffer);
      } catch (error) {
        clearTimeout(timer);
        resolveResult({ ok: false, error: String(error.message || error) });
      }
    });
    if (result.ok) return result;
    lastError = result.error;
  }
  return { ok: false, error: lastError };
}

export {
  isPacked,
  getAllRunningPrograms,
  startActivityListener,
  startRPCServer,
  stopRPCServer,
  createAppLoopback,
  hostArgs,
  runOnHost,
  playAudioBuffer,
  listPipeWireAudioApps,
  startPipeWireAudioCapture,
  stopPipeWireAudioCapture,
};
