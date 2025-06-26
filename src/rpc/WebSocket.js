import { getPortPromise } from "portfinder";

import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";

const PORT_RANGES = [6463, 6472];

export class WebSocketRPCServer extends EventEmitter {
  constructor(userToken, isPacked) {
    super();
    this.ws = null;
    this.RPCs = [];
    this.userToken = userToken;
    this.isPacked = isPacked;
    this.checkIfListeningInterval = null;
  }
  updateRPC(id, data) {
    if (!data) return this.removeRPC(id);
    const index = this.RPCs.findIndex((rpc) => rpc.id === id);
    if (index === -1) {
      this.RPCs.push({
        id,
        data: sanitizedData(data),
      });
      if (this.RPCs.length === 1) this.emitEvent();
      return;
    }

    if (JSONCompare(this.RPCs[index].data, sanitizedData(data))) {
      return;
    }
    this.RPCs[index].data = sanitizedData(data);
    if (index === 0) this.emitEvent();
  }
  removeRPC(id) {
    const index = this.RPCs.findIndex((rpc) => rpc.id === id);
    if (index === -1) {
      return;
    }
    this.RPCs.splice(index, 1);
    if (index === 0) {
      this.emitEvent();
    }
  }
  emitEvent() {
    const firstRPC = this.RPCs[0];
    if (!firstRPC) {
      return this.emit("RPC_UPDATE", undefined);
    }
    this.emit("RPC_UPDATE", firstRPC.data);
  }
  async serve() {
    const port = await getPortPromise({
      port: PORT_RANGES[0],
      stopPort: PORT_RANGES[1],
    }).catch(() => undefined);
    if (!port) return this.portFailed();

    this.ws = new WebSocketServer({ port, host: "localhost" });

    this.ws.on("listening", () => {
      Log(`Listening on port ${port}`);
    });
    this.ws.on("connection", async (client, req) => {
      if (!this.userToken) {
        Log("No User Token");
        client.close();
        return;
      }
      const appId = getAppId(req.url);
      if (!appId) {
        Log("No App Id");
        client.close();
        return;
      }
      const validAppId = appId === "checker" ? true : await checkAppId(appId, this.userToken, this.isPacked);
      if (!validAppId) {
        Log("Invalid App Id");
        client.close();
        return;
      }
      Log("Connected!");
      let greeted = false;
      let id =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
      let greetedTimeoutId = setTimeout(() => {
        client.close();
      }, 2000);

      client.send(
        JSON.stringify({
          name: "HELLO_NERIMITY_RPC",
        })
      );

      if (appId === "checker") {
        client.close();
        return;
      }

      client.onmessage = (event) => {
        const payload = safeParseJson(event.data);
        if (!payload) return client.close();
        if (payload.name === "HELLO_NERIMITY_RPC") {
          Log("Received HELLO_NERIMITY_RPC");
          clearTimeout(greetedTimeoutId);
          greeted = true;
          return;
        }
        if (!greeted) return;
        if (payload.name === "UPDATE_RPC") {
          this.updateRPC(id, payload.data);
          Log("Received UPDATE_RPC", payload.data);
        }
      };
      client.onclose = () => {
        this.updateRPC(id, null);
      };
    });

    this.ws.on("error", (err) => {
      console.error(err);
    });
    const checkIntervalMs = 30 * 1000; // 30 seconds
    this.checkIfListeningInterval = setInterval(async () => {
      const success = await checkIfListening(port);
      if (!success) {
        clearInterval(this.checkIfListeningInterval);
        this.destroy();
        this.serve();
      }
    }, checkIntervalMs);
  }
  portFailed() {
    this.ws?.removeAllListeners?.();
    Log("All ports are in use, giving up :(");
  }
  destroy() {
    this.checkIfListeningInterval && clearInterval(this.checkIfListeningInterval);
    if (this.ws) {
      this.ws.close();
      this.RPCs = [];
      this.ws = null;
      this.emitEvent();
      this.ws.removeAllListeners();
      this.removeAllListeners();
    }
  }
}

function JSONCompare(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Log(...args) {
  console.log("RPC WS>", ...args);
}

const safeParseJson = (str) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
};

const sanitizedData = (data) => {
  // name: "Spotify",
  // action: "Listening to",
  // imgSrc: data.art,
  // title: data.title,
  // subtitle: data.subtitle
  // startedAt: data.startedAt
  return JSON.parse(
    JSON.stringify({
      name: data.name?.substring(0, 30),
      action: data.action?.substring(0, 20),
      imgSrc: data.imgSrc?.substring(0, 250),
      title: data.title?.substring(0, 30),
      subtitle: data.subtitle?.substring(0, 30),
      link: data.link?.substring(0, 250),
      startedAt: data.startedAt,
      updatedAt: data.updatedAt,
      endsAt: data.endsAt,
      speed: data.speed,
    })
  );
};

const checkAppId = async (appId, token, isPacked) => {
  let url = `https://nerimity.com/api/applications/${appId}/exists`;
  if (!isPacked) {
    url = `http://localhost:8080/api/applications/${appId}/exists`;
  }
  const res = await fetch(url, {
    method: "HEAD",
    headers: {
      Authorization: token,
    },
  }).catch(() => {});

  return res?.status === 200;
};

const getAppId = (url) => {
  const params = new URLSearchParams(url.substring(1));
  const appId = params.get("appId");
  return appId;
};


const checkIfListening = (port) => {
  return new Promise(resolve => {
    Log("Checking if listening...");
    const client = new WebSocket(`ws://localhost:${port}/?appId=checker`);
    client.onclose = () => {
      Log("Failed.");
      client.close();
      resolve(false);
    }
    client.onmessage = (event) => {
      const payload = safeParseJson(event.data);
      if (!payload) return client.close();
      if (payload.name === "HELLO_NERIMITY_RPC") {
        Log("Success!");
        resolve(true);
        client.removeAllListeners();
        client.close();
      }
    }
  })
}