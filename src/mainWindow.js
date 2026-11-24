import {
  BrowserWindow,
  app,
  shell,
  desktopCapturer,
  ipcMain,
  dialog,
} from "electron";
import { readFileSync, readdirSync } from "fs";
import { spawn } from "child_process";
import { extname, join, basename } from "path";
import {
  getAutostart,
  setAutostart,
  getAutostartMinimized,
  setAutostartMinimized,
  getHardwareAccelerationDisabled,
  setHardwareAccelerationDisabled,
  getCustomTitlebarDisabled,
  setCustomTitlebarDisabled,
  get,
  set,
  getTtsVoice,
  setTtsVoice,
  getTtsLocale,
  setTtsLocale,
  getNativeScreenPicker,
  setNativeScreenPicker,
  getScreenShareAudioMode,
  setScreenShareAudioMode,
} from "./store.js";
import { setAppIcon, appIcon } from "./icon.js";
import { getTray } from "./tray.js";
import {
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
} from "./utils.js";
import {
  synthesizeEdgeTts,
  resolveVoiceForLocale,
  normalizeLocale,
} from "./tts.js";

import { uIOhook, UiohookKey } from "uiohook-napi";

const KeyCodeToName = Object.values(UiohookKey).reduce(
  (acc, key, i) => ({ ...acc, [key]: Object.keys(UiohookKey)[i] }),
  {},
);

const args = process.argv;
const startupMinimized = args.includes("--hidden");

if (getHardwareAccelerationDisabled()) {
  app.disableHardwareAcceleration();
}

if (!isPacked()) {
  app.commandLine.appendSwitch(
    'unsafely-treat-insecure-origin-as-secure',
    'http://local.nerimity.com:3000'
  )
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

const isWayland =
  Boolean(process.env.WAYLAND_DISPLAY) ||
  process.env.XDG_SESSION_TYPE === "wayland";
let displayMediaRequestInProgress = false;

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|ogg|m4a|opus|aac)$/i;

function audioMime(filePath) {
  return (
    {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".flac": "audio/flac",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
      ".opus": "audio/ogg",
      ".aac": "audio/aac",
    }[extname(filePath).toLowerCase()] || "audio/mpeg"
  );
}

function listAudioFiles(folder) {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.test(entry.name))
      .map((entry) => ({ name: entry.name, path: join(folder, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Could not list audio files:", error);
    return [];
  }
}

let pwIsolateTimer = null;

function runCommand(cmd, args = [], timeout = 15000) {
  const result = runOnHost([cmd, ...args], { timeout });
  return {
    ok: result.status === 0,
    out: (result.stdout || "").trim(),
    err: (result.stderr || "").trim(),
    status: result.status,
  };
}

function getNerimityOutputIds() {
  const dump = runCommand("pw-dump", []);
  if (!dump.ok) return [];
  try {
    return (JSON.parse(dump.out || "[]") || [])
      .filter((obj) => {
        const props = obj?.info?.props || {};
        return (
          props["media.class"] === "Stream/Output/Audio" &&
          /nerimity|electron/i.test(
            `${props["application.name"] || ""} ${props["node.name"] || ""}`,
          )
        );
      })
      .map((obj) => obj.id);
  } catch (_) {
    return [];
  }
}

function ensureIsolatedSink() {
  const sinks = runCommand("pw-dump", []);
  if (!sinks.ok || !/nerimity_isolated/.test(sinks.out)) {
    runCommand("pactl", [
      "load-module",
      "module-null-sink",
      "sink_name=nerimity_isolated",
      "sink_properties=device.description=NerimityIsolated",
    ]);
  }
}

function moveNerimityOutputs(target) {
  const moved = getNerimityOutputIds().map((id) => ({
    id,
    ...runCommand("wpctl", ["move", String(id), String(target)]),
  }));
  return { moved, count: moved.length };
}

function openSoundux(folder) {
  try {
    const config = {
      data: {
        tabs: [
          {
            id: 0,
            name: basename(folder) || "Audios",
            path: folder,
            sounds: [],
            sortMode: 1,
          },
        ],
        width: 1280,
        height: 720,
        soundIdCounter: 0,
      },
      settings: {
        audioBackend: 2, // PipeWire
        viewMode: 0,
        theme: 0,
        language: null,
        outputs: [],
        selectedTab: 0,
        localVolume: 70,
        remoteVolume: 100,
        allowMultipleOutputs: false,
        useAsDefaultDevice: false,
        muteDuringPlayback: false,
        allowOverlapping: true,
        minimizeToTray: true,
        tabHotkeysOnly: false,
        deleteToTrash: true,
        pushToTalkKeys: [],
        stopHotkey: [],
      },
    };

    // Allow the Soundux Flatpak to read the selected folder.
    runOnHost([
      "flatpak",
      "override",
      "--user",
      `--filesystem=${folder}`,
      "io.github.Soundux",
    ]);
    runOnHost(["flatpak", "kill", "io.github.Soundux"]);

    const writeScript =
      'mkdir -p "$HOME/.var/app/io.github.Soundux/config/Soundux" && ' +
      'cat > "$HOME/.var/app/io.github.Soundux/config/Soundux/config.json"';
    const written = runOnHost(["sh", "-c", writeScript], {
      input: JSON.stringify(config),
    });
    if (written.error || written.status !== 0) {
      throw written.error || new Error(written.stderr || "failed to write config");
    }

    const command = hostArgs(["flatpak", "run", "io.github.Soundux"]);
    const child = spawn(command[0], command.slice(1), {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    console.error("Soundux could not be started:", error);
    return { ok: false, error: String(error?.message || error) };
  }
}

let downKeys = new Set();
async function openMainWindow() {
  setStartup();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    center: true,
    frame: getCustomTitlebarDisabled(),
    autoHideMenuBar: true,
    show: !startupMinimized,
    icon: appIcon,
    backgroundColor: "#131416",
    webPreferences: {
      webSecurity: isPacked(),
      spellcheck: true,
      preload: join(__dirname, "preloaders", "mainPreloader.js"),
    },
  });

  // Optional companion UI (call-chat TTS reader and the audio-app picker).
  // The site itself owns its interface, so this is injected on dom-ready and
  // fails silently if a future site version removes the expected selectors.
  const injectedDir = join(__dirname, "..", "injected");
  let companionCss = "";
  let companionJs = "";
  try {
    companionCss = readFileSync(join(injectedDir, "vanilla-theme.css"), "utf8");
    companionJs = readFileSync(join(injectedDir, "enhancements.js"), "utf8");
  } catch (error) {
    console.error("Companion UI files are missing:", error);
  }
  mainWindow.on("closed", () => {
    if (pwIsolateTimer) clearInterval(pwIsolateTimer);
    pwIsolateTimer = null;
  });

  mainWindow.webContents.on("dom-ready", () => {
    if (companionCss) {
      mainWindow.webContents.insertCSS(companionCss).catch((error) =>
        console.error("Could not inject companion CSS:", error),
      );
    }
    if (companionJs) {
      mainWindow.webContents.executeJavaScript(companionJs).catch((error) =>
        console.error("Could not inject companion script:", error),
      );
    }
  });

  const sess = mainWindow.webContents.session;

  const appLoopback = createAppLoopback();

  sess.setDisplayMediaRequestHandler(async (request, callback) => {
    // On Wayland, getSources() opens the xdg-desktop-portal picker. Keep it
    // to one portal invocation per getDisplayMedia() call.
    if (displayMediaRequestInProgress) {
      callback({});
      return;
    }
    displayMediaRequestInProgress = true;
    try {
      let video = desktopCaptureSource;
      if (!video || video.id === "native-picker") {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        video = sources[0] || null;
      }

      let audio;
      if (
        request.audioRequested &&
        !["off", "silent"].includes(getScreenShareAudioMode())
      ) {
        audio = "loopback";
      }
      callback({ video, audio });
    } catch (error) {
      console.error("Screen share failed:", error);
      try {
        callback({});
      } catch (_) {}
    } finally {
      desktopCaptureSource = null;
      desktopCaptureSources = null;
      setTimeout(() => {
        displayMediaRequestInProgress = false;
      }, 1500);
    }
  });

  mainWindow.webContents.ipc.on("relaunch-app", () => {
    stopRPCServer();
    app.relaunch();
    app.exit();
  });

  // deprecated
  mainWindow.webContents.ipc.on("app-loopback-start", (e, captureSourceId) =>
    appLoopback.startCapture({
      type: "CaptureApp",
      chromeMediaSourceId: captureSourceId
    }),
  );

  mainWindow.webContents.ipc.on("app-loopback-start-v2", (e, opts) =>
    appLoopback.startCapture(opts),
  );
  mainWindow.webContents.ipc.on("app-loopback-reset", () =>
    appLoopback.reset(),
  );

  mainWindow.webContents.ipc.on("window-minimize", () => mainWindow.minimize());
  mainWindow.webContents.ipc.on("window-close", () => mainWindow.hide());

  mainWindow.webContents.ipc.handle("get-autostart", (event) => getAutostart());
  mainWindow.webContents.ipc.on("set-autostart", (event, value) => {
    setAutostart(value);
    setStartup();
  });

  mainWindow.webContents.ipc.handle("get-hw-acceleration-disabled", (event) =>
    getHardwareAccelerationDisabled(),
  );
  mainWindow.webContents.ipc.on(
    "set-hw-acceleration-disabled",
    (event, value) => {
      setHardwareAccelerationDisabled(value);
    },
  );
  mainWindow.webContents.ipc.handle("get-custom-titlebar-disabled", (event) =>
    getCustomTitlebarDisabled(),
  );
  mainWindow.webContents.ipc.on(
    "set-custom-titlebar-disabled",
    (event, value) => {
      setCustomTitlebarDisabled(value);
    },
  );

  mainWindow.webContents.ipc.handle("get-autostart-minimized", (event) =>
    getAutostartMinimized(),
  );
  mainWindow.webContents.ipc.on("set-autostart-minimized", (event, value) => {
    setAutostartMinimized(value);
    setStartup();
  });

  mainWindow.webContents.ipc.handle(
    "extra-get-setting",
    (event, key, fallback) => {
      const value = get(key);
      return value === undefined ? fallback : value;
    },
  );
  mainWindow.webContents.ipc.on("extra-set-setting", (event, key, value) =>
    set(key, value),
  );

  mainWindow.webContents.ipc.handle("extra-choose-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Audio folder for the call",
      properties: ["openDirectory"],
    });
    return canceled ? null : filePaths[0];
  });
  mainWindow.webContents.ipc.handle("extra-list-audio-files", (event, folder) =>
    listAudioFiles(String(folder || "")),
  );
  mainWindow.webContents.ipc.handle("extra-read-audio-file", (event, filePath) => {
    const file = String(filePath || "");
    if (!AUDIO_EXTENSIONS.test(file)) return null;
    try {
      const base64 = readFileSync(file).toString("base64");
      return `data:${audioMime(file)};base64,${base64}`;
    } catch (error) {
      console.error("Could not read audio file:", error);
      return null;
    }
  });
  mainWindow.webContents.ipc.handle("extra-open-soundux", (event, folder) =>
    openSoundux(String(folder || "")),
  );
  mainWindow.webContents.ipc.handle("extra-open-qpwgraph", () => {
    try {
      const command = hostArgs(["qpwgraph"]);
      const child = spawn(command[0], command.slice(1), {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
  mainWindow.webContents.ipc.handle(
    "extra-pipewire-isolate",
    (event, enable) => {
      try {
        if (enable) {
          ensureIsolatedSink();
          const result = moveNerimityOutputs("nerimity_isolated");
          if (pwIsolateTimer) clearInterval(pwIsolateTimer);
          pwIsolateTimer = setInterval(() => {
            try {
              ensureIsolatedSink();
              moveNerimityOutputs("nerimity_isolated");
            } catch (_) {}
          }, 3000);
          return { ok: true, enabled: true, ...result };
        }
        if (pwIsolateTimer) {
          clearInterval(pwIsolateTimer);
          pwIsolateTimer = null;
        }
        return {
          ok: true,
          enabled: false,
          ...moveNerimityOutputs("@DEFAULT_AUDIO_SINK@"),
        };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    },
  );

  mainWindow.webContents.ipc.handle("get-tts-settings", () => ({
    voice: getTtsVoice(),
    locale: getTtsLocale(),
  }));
  mainWindow.webContents.ipc.on("set-tts-voice", (event, value) =>
    setTtsVoice(String(value || "")),
  );
  mainWindow.webContents.ipc.on("set-tts-locale", (event, value) =>
    setTtsLocale(String(value || "auto")),
  );
  mainWindow.webContents.ipc.handle("tts-speak", async (event, payload) => {
    const opts = typeof payload === "string" ? { text: payload } : payload || {};
    const text = String(opts.text || "")
      .slice(0, 500)
      .trim();
    if (!text) return { ok: false, error: "empty" };

    const rate = Math.max(0.7, Math.min(1.6, Number(opts.rate) || 1));
    const ratePercent = Math.round((rate - 1) * 100);
    const rateStr = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;
    const pitchValue = Number(opts.pitch);
    const pitchHz = Number.isFinite(pitchValue)
      ? Math.round((pitchValue - 50) / 5)
      : 0;
    const pitchStr = `${pitchHz >= 0 ? "+" : ""}${pitchHz}Hz`;

    // Priority: explicit voice > panel setting > Nerimity/app locale.
    const configuredLocale = String(getTtsLocale() || "auto").trim();
    const locale =
      opts.language ||
      (configuredLocale && configuredLocale !== "auto" ? configuredLocale : "") ||
      app.getLocale() ||
      process.env.LANG ||
      "";
    const voice =
      String(opts.voice || getTtsVoice() || "").trim() ||
      resolveVoiceForLocale(locale);

    try {
      const mp3 = await synthesizeEdgeTts({
        text,
        voice,
        rate: rateStr,
        pitch: pitchStr,
        timeoutMs: 30000,
      });
      if (!mp3?.length) {
        return { ok: false, error: "service returned no audio" };
      }
      const played = await playAudioBuffer(mp3);
      if (!played.ok) {
        return {
          ok: false,
          error: `audio generated, but no player worked: ${played.error}`,
          backend: `edge-tts/${voice}`,
          voice,
        };
      }
      return {
        ok: true,
        backend: `edge-tts/${voice}`,
        voice,
        locale: normalizeLocale(locale),
        player: played.player,
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error).slice(0, 300),
        voice,
      };
    }
  });

  mainWindow.webContents.ipc.handle("get-screen-share-settings", () => ({
    nativePicker: getNativeScreenPicker(),
    audioMode: getScreenShareAudioMode(),
  }));
  mainWindow.webContents.ipc.on("set-native-screen-picker", (event, value) =>
    setNativeScreenPicker(Boolean(value)),
  );
  mainWindow.webContents.ipc.on("set-screen-share-audio-mode", (event, value) =>
    setScreenShareAudioMode(String(value || "full")),
  );
  mainWindow.webContents.ipc.handle("list-audio-apps", () =>
    listPipeWireAudioApps(),
  );
  mainWindow.webContents.ipc.handle("start-audio-app-capture", (event, apps) =>
    startPipeWireAudioCapture(apps),
  );
  mainWindow.webContents.ipc.handle("stop-audio-app-capture", () =>
    stopPipeWireAudioCapture(),
  );

  const sendKey = (e, down) => {
    mainWindow.webContents.send("global-key", { down, event: e });
  };

  mainWindow.webContents.ipc.on("start-global-key-listener", () => {
    downKeys.clear();
    uIOhook.start();
    uIOhook.removeAllListeners();

    uIOhook.on("keydown", (e) => {
      if (!downKeys.has(e.keycode)) {
        sendKey(
          {
            vKey: e.keycode,
            name: KeyCodeToName[e.keycode.toString()],
            state: "DOWN",
          },
          false,
        );
      }
      downKeys.add(e.keycode);
    });
    uIOhook.on("keyup", (e) => {
      sendKey(
        {
          vKey: e.keycode,
          name: KeyCodeToName[e.keycode.toString()],
          state: "UP",
        },
        true,
      );
      downKeys.delete(e.keycode);
    });
  });
  mainWindow.webContents.ipc.on("stop-global-key-listener", () => {
    uIOhook.stop();
    downKeys.clear();
  });

  mainWindow.webContents.ipc.on("window-toggle-maximize", () => {
    if (mainWindow.isMaximized()) return mainWindow.unmaximize();
    mainWindow.maximize();
  });
  mainWindow.webContents.ipc.on("set-notification", (event, value, count) => {
    setAppIcon({
      window: mainWindow,
      tray: getTray(),
      type: value ? "NOTIFICATION" : "NORMAL",
      count,
    });
    getTray()?.setToolTip(
      value ? `Nerimity — ${count || ""} notifications` : "Nerimity",
    );
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const internalHosts = [
        "nerimity.com",
        "www.nerimity.com",
        "local.nerimity.com",
        "localhost",
      ];
      if (!internalHosts.includes(host)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch (_) {
      // Invalid URL: let Electron handle it.
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsedUrl = new URL(details.url);
      if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") {
        shell.openExternal(details.url);
      }
    } catch (err) {
      //  invalid url
    }
    return { action: "deny" };
  });

  mainWindow.webContents.ipc.handle(
    "get-desktop-capture-sources",
    async (event) => {
      desktopCaptureSource = null;
      // Listing sources on Wayland would open the portal picker immediately,
      // before the user actually starts sharing. Use a placeholder and open
      // the real picker from the display-media handler.
      if (isWayland && getNativeScreenPicker()) {
        desktopCaptureSources = null;
        return [
          {
            id: "native-picker",
            name: "Select window or screen (Wayland)",
            thumbnailUrl: "",
          },
        ];
      }
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
    },
  );

  mainWindow.webContents.ipc.handle(
    "set-desktop-capture-source-id",
    async (event, id) => {
      desktopCaptureSource =
        desktopCaptureSources?.find((source) => source.id === id) || null;
      return true;
    },
  );

  mainWindow.webContents.ipc.handle(
    "get-running-programs",
    async (event, ignoredPrograms = []) => {
      return await getAllRunningPrograms(ignoredPrograms);
    },
  );

  mainWindow.webContents.ipc.on("replace-misspelling", (event, word) => {
    mainWindow.webContents.replaceMisspelling(word);
  });
  mainWindow.webContents.ipc.on(
    "restart-activity-status",
    (event, listenToPrograms = []) => {
      startActivityListener(listenToPrograms, mainWindow);
    },
  );
  mainWindow.webContents.ipc.on("restart-rpc-server", async () => {
    const userToken = await getUserToken();

    startRPCServer(mainWindow, userToken);
  });

  mainWindow.on("close", function (event) {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }

    appLoopback.reset();
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

  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  mainWindow.webContents.on("context-menu", (event, params) => {
    mainWindow.webContents.send("spellcheck", params.dictionarySuggestions);
  });

  let didLoadSuccess = false;
  mainWindow.webContents.on("did-navigate", () => {
    didLoadSuccess = true;
  });
  mainWindow.webContents.on("did-fail-load", function () {
    if (didLoadSuccess) return;
    console.log("Failed to load, retrying... in 5 seconds");

    setTimeout(async () => {
      if (isPacked()) {
        await mainWindow.loadURL("https://nerimity.com/login");
      } else {
        await mainWindow.loadURL("http://localhost:3000/login");
      }
    }, 5000);
  });
  if (isPacked()) {
    await mainWindow.loadURL("https://nerimity.com/login");
  } else {
    // await mainWindow.loadURL("http://localhost:3000/login");
    await mainWindow.loadURL("http://local.nerimity.com:3000/login");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

const getUserToken = async () => {
  const token = await mainWindow.webContents.executeJavaScript(
    'localStorage.getItem("userToken");',
    true,
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
  app.setLoginItemSettings({
    enabled: autostartEnabled,
    openAtLogin: autostartEnabled,
    openAsHidden: autostartMinimized,
    path: appPath,
    args: autostartMinimized ? ["--hidden"] : [],
  });
}
