import { EventEmitter } from "events";
import net from "net";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";

const OPCODE = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
};

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 3000;
const PROBE_CONNECT_TIMEOUT_MS = 300;
const DEFAULT_PROBE_INTERVAL_MS = 10_000;
const IPC_INDEXES = Array.from({ length: 10 }, (_, i) => i);

const FAKE_USER = {
  id: "100000000000000000",
  username: "Nerimity",
  discriminator: "0",
  global_name: "Nerimity",
  avatar: null,
  verified: true,
  email: null,
  flags: 0,
  premium_type: 0,
  bot: false,
  mfa_enabled: false,
};

const ACTIVITY_TYPE_TO_ACTION = {
  0: "Playing",
  1: "Streaming",
  2: "Listening to",
  3: "Watching",
  5: "Competing in",
};

/**
 * Impersonates the Discord desktop app's local IPC endpoint. Apps that push
 * rich presence to Discord (games, media players, editor plugins) connect to a
 * `discord-ipc-*` socket/pipe; when Discord is closed they connect here
 * instead, and their activities are republished as Nerimity RPC entries.
 *
 * Steps aside whenever a foreign server answers on any Discord IPC endpoint,
 * so the real Discord app always wins.
 */
export class DiscordBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    const platform = options.platform ?? process.platform;
    const { bindPaths, probePaths } = defaultIpcPaths(platform);
    this.bindPaths = options.bindPaths ?? bindPaths;
    this.probePaths = options.probePaths ?? probePaths;
    this.probeIntervalMs = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
    this.resolveProcessName = options.resolveProcessName ?? resolveProcessName;

    /** @type {Map<string, {data: Record<string, any>}>} */
    this.activities = new Map();
    /** @type {Set<string>} */
    this.ownedPaths = new Set();
    /** @type {Set<net.Server>} */
    this.servers = new Set();
    /** @type {Set<{id: string, socket: net.Socket, closed: boolean}>} */
    this.connections = new Set();

    this.started = false;
    this.reconciling = false;
    this.bound = false;
    this.probeInterval = null;
    this.connCounter = 0;
  }

  start() {
    if (this.started) return Promise.resolve();
    this.started = true;
    this.probeInterval = setInterval(() => {
      this.reconcile().catch(() => {});
    }, this.probeIntervalMs);
    this.probeInterval.unref?.();
    return this.reconcile();
  }

  stop() {
    this.started = false;
    if (this.probeInterval) {
      clearInterval(this.probeInterval);
      this.probeInterval = null;
    }
    const hadEntries = this.activities.size > 0;
    this.teardown();
    if (hadEntries) this.emitUpdate();
  }

  /**
   * Detects a foreign Discord server; pauses us if one answers, resumes
   * binding when none do. Also the initial start path.
   */
  async reconcile() {
    if (!this.started || this.reconciling) return;
    this.reconciling = true;
    try {
      const foreign = await this.probeForeign();
      if (!this.started) return;
      if (foreign) {
        if (this.bound) {
          Log("Discord is running, stepping aside");
          const hadEntries = this.activities.size > 0;
          this.teardown();
          if (hadEntries) this.emitUpdate();
        }
        return;
      }
      if (!this.bound) {
        Log("Binding Discord IPC endpoints");
        await this.bindAll();
      }
    } finally {
      this.reconciling = false;
    }
  }

  getRPCs() {
    return [...this.activities.entries()].map(([id, entry]) => ({
      id,
      data: entry.data,
    }));
  }

  async probeForeign() {
    for (const probePath of this.probePaths) {
      if (this.ownedPaths.has(probePath)) continue;
      const alive = await tryConnect(probePath);
      if (alive) return true;
    }
    return false;
  }

  async bindAll() {
    for (const bindPath of this.bindPaths) {
      if (!this.started || this.ownedPaths.has(bindPath)) continue;
      if (process.platform !== "win32" && fs.existsSync(bindPath)) {
        // Stale socket from a crashed process blocks listen(); a live one was
        // already caught by probeForeign().
        if (await tryConnect(bindPath)) continue;
        await fs.promises.unlink(bindPath).catch(() => {});
      }
      if (!this.started) return;
      const server = net.createServer((socket) => this.accept(socket));
      server.on("error", () => {});

      const bound = await new Promise((resolve) => {
        const onError = () => resolve(false);
        server.once("error", onError);
        server.listen(bindPath, () => {
          server.removeListener("error", onError);
          resolve(true);
        });
      });

      if (!bound) {
        server.removeAllListeners();
        continue;
      }
      if (!this.started) {
        server.close();
        return;
      }
      this.ownedPaths.add(bindPath);
      this.servers.add(server);
    }
    this.bound = this.servers.size > 0;
  }

  teardown() {
    this.bound = false;
    for (const server of this.servers) {
      server.close();
      server.removeAllListeners();
    }
    this.servers.clear();
    this.ownedPaths.clear();
    for (const conn of this.connections) {
      conn.closed = true;
      conn.socket.destroy();
    }
    this.connections.clear();
    this.activities.clear();
  }

  accept(socket) {
    socket.setNoDelay?.(true);
    const conn = {
      id: `c${++this.connCounter}`,
      socket,
      buffer: Buffer.alloc(0),
      handshakeDone: false,
      clientId: null,
      closed: false,
      handshakeTimeout: setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS),
    };
    this.connections.add(conn);

    socket.on("data", (chunk) => this.onData(conn, chunk));
    socket.on("error", () => this.closeConnection(conn));
    socket.on("close", () => this.closeConnection(conn));
  }

  closeConnection(conn) {
    if (conn.closed) return;
    conn.closed = true;
    clearTimeout(conn.handshakeTimeout);
    this.connections.delete(conn);
    const prefix = `${conn.id}:`;
    let changed = false;
    for (const key of [...this.activities.keys()]) {
      if (key.startsWith(prefix)) {
        this.activities.delete(key);
        changed = true;
      }
    }
    conn.socket.destroy();
    if (changed) this.emitUpdate();
  }

  onData(conn, chunk) {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    while (conn.buffer.length >= 8) {
      const opcode = conn.buffer.readUInt32LE(0);
      const length = conn.buffer.readUInt32LE(4);
      if (length > MAX_PAYLOAD_BYTES) {
        conn.socket.destroy();
        return;
      }
      if (conn.buffer.length < 8 + length) return;
      const payload = conn.buffer.subarray(8, 8 + length);
      conn.buffer = conn.buffer.subarray(8 + length);
      this.onMessage(conn, opcode, payload);
      if (conn.closed || conn.socket.destroyed) return;
    }
  }

  onMessage(conn, opcode, payload) {
    if (opcode === OPCODE.HANDSHAKE) return this.onHandshake(conn, payload);
    if (opcode === OPCODE.PING) {
      return this.sendRaw(conn, OPCODE.PONG, payload);
    }
    if (opcode === OPCODE.CLOSE) {
      return conn.socket.destroy();
    }
    if (opcode !== OPCODE.FRAME || !conn.handshakeDone) return;

    const message = safeParseJson(payload.toString("utf8"));
    if (!message || typeof message.cmd !== "string") {
      conn.socket.destroy();
      return;
    }
    if (message.cmd === "SET_ACTIVITY") return this.onSetActivity(conn, message);
    if (message.cmd === "SUBSCRIBE" || message.cmd === "UNSUBSCRIBE") {
      return this.reply(conn, message, null);
    }
    if (message.cmd === "GET_CURRENT_USER") {
      return this.reply(conn, message, FAKE_USER);
    }
    this.send(conn, {
      cmd: message.cmd,
      evt: "ERROR",
      data: { code: 4000, message: "Unknown command" },
      nonce: message.nonce ?? null,
    });
  }

  onHandshake(conn, payload) {
    const handshake = safeParseJson(payload.toString("utf8"));
    if (!handshake || !handshake.client_id) {
      conn.socket.destroy();
      return;
    }
    conn.clientId = String(handshake.client_id);
    if (conn.handshakeDone) return;
    conn.handshakeDone = true;
    clearTimeout(conn.handshakeTimeout);
    this.send(conn, {
      cmd: "DISPATCH",
      evt: "READY",
      nonce: null,
      data: {
        v: handshake.v ?? 1,
        config: {
          cdn_host: "cdn.discordapp.com",
          api_endpoint: "//discord.com/api",
          environment: "production",
        },
        user: FAKE_USER,
      },
    });
  }

  onSetActivity(conn, message) {
    const args = message.args ?? {};
    const pid = /^\d+$/.test(String(args.pid ?? ""))
      ? String(args.pid)
      : String(conn.id);
    const key = `${conn.id}:${pid}`;
    const activity = args.activity ?? null;

    this.reply(conn, message, activity);

    if (!activity || typeof activity !== "object") {
      if (this.activities.delete(key)) this.emitUpdate();
      return;
    }
    if (Number(activity.type) === 4) {
      // Custom statuses are client-only; the remote tracker drops them too.
      if (this.activities.delete(key)) this.emitUpdate();
      return;
    }

    const previous = this.activities.get(key)?.data;
    const data = sanitizeRPC(
      mapActivity(activity, conn.clientId, previous?.name),
    );
    if (previous && JSON.stringify(previous) === JSON.stringify(data)) return;

    this.activities.set(key, { data });
    this.emitUpdate();

    const explicitName =
      typeof activity.name === "string" && activity.name.trim().length > 0;
    if (!explicitName) this.fillNameFromProcess(key, pid);
  }

  async fillNameFromProcess(key, pid) {
    const name = await this.resolveProcessName(pid).catch(() => null);
    if (!name) return;
    const entry = this.activities.get(key);
    // "Unknown" is the placeholder; skip if a newer update set a real name.
    if (!entry || entry.data.name !== "Unknown") return;
    const data = sanitizeRPC({ ...entry.data, name });
    if (JSON.stringify(entry.data) === JSON.stringify(data)) return;
    entry.data = data;
    this.emitUpdate();
  }

  reply(conn, message, data) {
    this.send(conn, {
      cmd: message.cmd,
      evt: null,
      data,
      nonce: message.nonce ?? null,
    });
  }

  send(conn, payload) {
    this.sendRaw(conn, OPCODE.FRAME, Buffer.from(JSON.stringify(payload)));
  }

  sendRaw(conn, opcode, body) {
    if (conn.closed || conn.socket.destroyed) return;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode, 0);
    header.writeUInt32LE(body.length, 4);
    conn.socket.write(Buffer.concat([header, body]));
  }

  emitUpdate() {
    this.emit("update", this.getRPCs());
  }
}

function defaultIpcPaths(platform) {
  if (platform === "win32") {
    const pipe = (i) => `\\\\.\\pipe\\discord-ipc-${i}`;
    return {
      bindPaths: [pipe(0)],
      probePaths: IPC_INDEXES.map(pipe),
    };
  }
  const dirs = new Set();
  if (process.env.XDG_RUNTIME_DIR) {
    dirs.add(process.env.XDG_RUNTIME_DIR);
    dirs.add(path.join(process.env.XDG_RUNTIME_DIR, "app", "com.discordapp.Discord"));
    dirs.add(path.join(process.env.XDG_RUNTIME_DIR, "snap.discord"));
  }
  dirs.add(os.tmpdir());
  dirs.add("/tmp");

  const all = [];
  for (const dir of dirs) {
    for (const i of IPC_INDEXES) all.push(path.join(dir, `discord-ipc-${i}`));
  }
  return {
    bindPaths: [...dirs].map((dir) => path.join(dir, "discord-ipc-0")),
    probePaths: all,
  };
}

function mapActivity(activity, clientId, previousName) {
  const type = Number(activity.type ?? 0);
  const action = ACTIVITY_TYPE_TO_ACTION[type] ?? "Playing";

  const syncId = activity.sync_id ?? activity.syncId;
  const firstButton = Array.isArray(activity.buttons)
    ? activity.buttons[0]
    : undefined;

  let link;
  if (syncId) {
    link = `https://open.spotify.com/track/${syncId}`;
  } else if (firstButton?.url) {
    link = firstButton.url;
  } else if (type === 1 && activity.url) {
    link = activity.url;
  }
  // Clients control this value; only plain web URLs reach the profile.
  if (link && !/^https?:\/\//i.test(link)) link = undefined;

  const explicitName =
    typeof activity.name === "string" && activity.name.trim().length > 0
      ? activity.name
      : previousName && previousName !== "Unknown"
        ? previousName
        : undefined;

  return {
    name: explicitName ?? "Unknown",
    action,
    imgSrc:
      resolveImage(activity.assets?.large_image, clientId) ??
      resolveImage(activity.assets?.small_image, clientId),
    title: activity.details ?? undefined,
    subtitle: activity.state ?? undefined,
    link,
    startedAt: activity.timestamps?.start ?? undefined,
    endsAt: activity.timestamps?.end ?? undefined,
  };
}

function resolveImage(image, clientId) {
  if (!image || typeof image !== "string") return undefined;
  if (/^https?:\/\//i.test(image)) return image;

  const spotifyMatch = image.match(/^spotify:([0-9a-f]{16,})$/i);
  if (spotifyMatch) return `https://i.scdn.co/image/${spotifyMatch[1]}`;

  if (/^[0-9a-f]{32}$/i.test(image) && clientId) {
    return `https://cdn.discordapp.com/app-assets/${clientId}/${image}.png`;
  }
  // mp:external/... and other opaque keys cannot be resolved outside Discord.
  return undefined;
}

function sanitizeRPC(data) {
  return JSON.parse(
    JSON.stringify({
      name: data.name?.substring(0, 30),
      action: data.action?.substring(0, 20),
      imgSrc: data.imgSrc?.substring(0, 250),
      title: data.title?.substring(0, 30),
      subtitle: data.subtitle?.substring(0, 30),
      link: data.link?.substring(0, 250),
      startedAt: data.startedAt,
      endsAt: data.endsAt,
    }),
  );
}

function resolveProcessName(pid) {
  return (async () => {
    const cacheKey = String(pid);
    const cached = processNameCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let name = null;
    try {
      if (process.platform === "linux") {
        try {
          name = path.basename(await fs.promises.readlink(`/proc/${pid}/exe`));
        } catch {
          const comm = await fs.promises.readFile(`/proc/${pid}/comm`, "utf8");
          name = comm.trim() || null;
        }
      } else if (process.platform === "darwin") {
        const out = await execFilePromise("ps", ["-p", String(pid), "-o", "comm="]);
        name = out.trim() ? path.basename(out.trim()) : null;
      } else if (process.platform === "win32") {
        const out = await execFilePromise("tasklist", [
          "/nh",
          "/fo",
          "csv",
          "/fi",
          `PID eq ${pid}`,
        ]);
        const firstLine = out.split(/\r?\n/)[0] ?? "";
        const match = firstLine.match(/^"([^"]+)"/);
        if (match) name = match[1].replace(/\.exe$/i, "");
      }
    } catch {
      name = null;
    }
    name = name?.trim() || null;
    processNameCache.set(cacheKey, name);
    return name;
  })();
}

// Shared across instances; process names for a pid do not change.
const processNameCache = new Map();

function execFilePromise(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 3000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function tryConnect(target) {
  return new Promise((resolve) => {
    const socket = net.connect(target);
    let settled = false;
    const finish = (alive) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(PROBE_CONNECT_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

const safeParseJson = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

function Log(...args) {
  console.log("RPC Discord>", ...args);
}
