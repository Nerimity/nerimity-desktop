import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "net";
import fs from "fs";
import os from "os";
import path from "path";

import { DiscordBridge } from "./DiscordBridge.js";

const tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neri-discord-ipc-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

class TestClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    socket.on("data", (chunk) => this.onData(chunk));
  }
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + length) return;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      const frame = { opcode, json: safeParse(body.toString("utf8")), raw: body };
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(frame);
      else this.queue.push(frame);
    }
  }
  nextFrame(timeoutMs = 2000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for frame")),
        timeoutMs,
      );
      this.waiters.push({
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }
  send(opcode, payload) {
    this.sendRaw(opcode, Buffer.from(JSON.stringify(payload)));
  }
  sendRaw(opcode, body) {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode, 0);
    header.writeUInt32LE(body.length, 4);
    this.socket.write(Buffer.concat([header, body]));
  }
  handshake() {
    this.send(0, { v: 1, client_id: "1234567890" });
    return this.nextFrame();
  }
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(target);
    socket.once("connect", () => resolve(new TestClient(socket)));
    socket.once("error", reject);
  });
}

function canConnect(target) {
  return connect(target)
    .then((client) => {
      client.socket.destroy();
      return true;
    })
    .catch(() => false);
}

async function waitUntil(check, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition not met within " + timeoutMs + "ms");
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

test("handshake answers READY and SET_ACTIVITY maps to a Nerimity RPC entry", async () => {
  const dir = makeTmpDir();
  const ipcPath = path.join(dir, "discord-ipc-0");
  const bridge = new DiscordBridge({
    bindPaths: [ipcPath],
    probePaths: [ipcPath],
    probeIntervalMs: 60_000,
  });
  try {
    await bridge.start();
    const client = await connect(ipcPath);

    const ready = await client.handshake();
    assert.equal(ready.opcode, 1);
    assert.equal(ready.json.evt, "READY");
    assert.ok(ready.json.data.user.username);

    client.send(1, {
      cmd: "SET_ACTIVITY",
      nonce: "n1",
      args: {
        pid: process.pid,
        activity: {
          type: 2,
          name: "FakeApp",
          details: "Track",
          state: "Artist",
          timestamps: { start: 1000, end: 2000 },
          assets: {
            large_image: "spotify:ab67616d0000b273abcdef0123456789abcdef01",
          },
          sync_id: "abc123",
        },
      },
    });

    const reply = await client.nextFrame();
    assert.equal(reply.json.cmd, "SET_ACTIVITY");
    assert.equal(reply.json.nonce, "n1");

    const rpcs = bridge.getRPCs();
    assert.equal(rpcs.length, 1);
    assert.ok(rpcs[0].id.endsWith(`:${process.pid}`));
    assert.deepEqual(rpcs[0].data, {
      name: "FakeApp",
      action: "Listening to",
      imgSrc: "https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcdef01",
      title: "Track",
      subtitle: "Artist",
      link: "https://open.spotify.com/track/abc123",
      startedAt: 1000,
      endsAt: 2000,
    });

    client.socket.destroy();
  } finally {
    bridge.stop();
  }
});

test("missing activity name falls back to the sending process name", async () => {
  const dir = makeTmpDir();
  const ipcPath = path.join(dir, "discord-ipc-0");
  const bridge = new DiscordBridge({
    bindPaths: [ipcPath],
    probePaths: [ipcPath],
    probeIntervalMs: 60_000,
  });
  try {
    await bridge.start();
    const client = await connect(ipcPath);
    await client.handshake();

    client.send(1, {
      cmd: "SET_ACTIVITY",
      nonce: "n2",
      args: {
        pid: process.pid,
        activity: { type: 0, details: "In menu" },
      },
    });
    await client.nextFrame();

    const expectedName = path.basename(process.execPath);
    await waitUntil(
      () => bridge.getRPCs()[0]?.data.name === expectedName,
      3000,
    );
    assert.equal(bridge.getRPCs()[0].data.action, "Playing");
    assert.equal(bridge.getRPCs()[0].data.title, "In menu");

    client.socket.destroy();
  } finally {
    bridge.stop();
  }
});

test("clearing the activity and disconnecting both remove the entry", async () => {
  const dir = makeTmpDir();
  const ipcPath = path.join(dir, "discord-ipc-0");
  const bridge = new DiscordBridge({
    bindPaths: [ipcPath],
    probePaths: [ipcPath],
    probeIntervalMs: 60_000,
  });
  try {
    await bridge.start();
    const client = await connect(ipcPath);
    await client.handshake();

    client.send(1, {
      cmd: "SET_ACTIVITY",
      nonce: "a",
      args: { pid: 42, activity: { type: 0, name: "Game", details: "x" } },
    });
    await client.nextFrame();
    assert.equal(bridge.getRPCs().length, 1);

    client.send(1, {
      cmd: "SET_ACTIVITY",
      nonce: "b",
      args: { pid: 42, activity: null },
    });
    await client.nextFrame();
    assert.equal(bridge.getRPCs().length, 0);

    client.send(1, {
      cmd: "SET_ACTIVITY",
      nonce: "c",
      args: { pid: 42, activity: { type: 0, name: "Game" } },
    });
    await client.nextFrame();
    assert.equal(bridge.getRPCs().length, 1);

    client.socket.destroy();
    await waitUntil(() => bridge.getRPCs().length === 0);
  } finally {
    bridge.stop();
  }
});

test("ping is answered with pong and foreign servers pause and release the bridge", async () => {
  const dir = makeTmpDir();
  const ipc0 = path.join(dir, "discord-ipc-0");
  const ipc1 = path.join(dir, "discord-ipc-1");
  const bridge = new DiscordBridge({
    bindPaths: [ipc0],
    probePaths: [ipc0, ipc1],
    probeIntervalMs: 50,
  });
  let decoy = null;
  try {
    await bridge.start();
    const client = await connect(ipc0);
    await client.handshake();

    client.sendRaw(3, Buffer.from("hello"));
    const pong = await client.nextFrame();
    assert.equal(pong.opcode, 4);
    assert.equal(pong.raw.toString("utf8"), "hello");

    client.send(1, {
      cmd: "SET_ACTIVITY",
      nonce: "d",
      args: { pid: 7, activity: { type: 0, name: "Game" } },
    });
    await client.nextFrame();
    assert.equal(bridge.getRPCs().length, 1);

    // A foreign Discord answering on a neighbouring endpoint pauses us and
    // clears captured activities.
    decoy = net.createServer(() => {});
    await new Promise((resolve, reject) => {
      decoy.once("error", reject);
      decoy.listen(ipc1, resolve);
    });
    await waitUntil(
      async () =>
        bridge.getRPCs().length === 0 && !(await canConnect(ipc0)),
      3000,
    );

    // Discord exits: the interval rebinds.
    await new Promise((resolve) => decoy.close(resolve));
    decoy = null;
    await waitUntil(() => canConnect(ipc0), 3000);
  } finally {
    if (decoy) await new Promise((resolve) => decoy.close(resolve));
    bridge.stop();
  }
});
