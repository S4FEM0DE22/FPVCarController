const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { WebSocket } = require("ws");

const SERVER_START_TIMEOUT_MS = 5000;
const MESSAGE_TIMEOUT_MS = 3000;

let serverProcess;
let serverPort;

function getFreePort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ws = await connectClient(url);
      ws.close();
      return;
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

function startServer() {
  serverPort = getFreePort();
  const serverDir = path.resolve(__dirname, "..");

  serverProcess = spawn(process.execPath, ["index.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(serverPort),
      VEHICLE_AUTH_TOKEN: "",
      CONTROLLER_AUTH_TOKEN: "",
      ALLOW_LOCALHOST_AUTH_BYPASS: "true",
      CONTROL_ACTION_RATE_LIMIT_WINDOW_MS: "5000",
      CONTROL_ACTION_RATE_LIMIT_MAX_MESSAGES: "5",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  serverProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      // Surface startup/runtime crashes to tests via stderr capture.
      process.stderr.write(`Server exited with code ${code}\n${stderr}`);
    }
  });

  return waitForServer(`ws://127.0.0.1:${serverPort}`, SERVER_START_TIMEOUT_MS);
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => resolve();

    serverProcess.once("exit", done);
    serverProcess.kill();

    setTimeout(() => {
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
      resolve();
    }, 1500);
  });
}

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const onOpen = () => {
      cleanup();
      resolve(ws);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      ws.off("open", onOpen);
      ws.off("error", onError);
    };

    ws.on("open", onOpen);
    ws.on("error", onError);
  });
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function waitForMessage(ws, predicate, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const onMessage = (raw) => {
      const data = JSON.parse(raw.toString());
      if (predicate(data)) {
        cleanup();
        resolve(data);
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

test.before(async () => {
  await startServer();
});

test.after(async () => {
  await stopServer();
});

test("identify flow registers controller and returns initial status", async () => {
  const vehicleId = `test-identify-${Date.now()}`;
  const ws = await connectClient(`ws://127.0.0.1:${serverPort}`);

  try {
    sendJson(ws, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });

    const ack = await waitForMessage(
      ws,
      (msg) => msg.type === "ack" && /Controller registered/.test(msg.message)
    );
    assert.equal(ack.type, "ack");

    const status = await waitForMessage(
      ws,
      (msg) => msg.type === "status" && msg.vehicleId === vehicleId
    );
    assert.equal(status.state, "offline");
    assert.match(status.message, /ESP not connected|ESP available/);
  } finally {
    ws.close();
  }
});

test("control forwarding sends command to esp peer", async () => {
  const vehicleId = `test-control-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;

  const esp = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(esp, { type: "identify", clientType: "esp", vehicleId });
    await waitForMessage(esp, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(
      controller,
      (msg) => msg.type === "ack" && /Controller registered/.test(msg.message)
    );

    const commandId = `cmd-${Date.now()}`;
    sendJson(controller, {
      type: "control",
      vehicleId,
      source: "keyboard",
      command: "FORWARD",
      payload: {
        throttle: 1,
        steering: 0,
      },
      timestamp: Date.now(),
      commandId,
    });

    const forwarded = await waitForMessage(
      esp,
      (msg) => msg.type === "control" && msg.commandId === commandId
    );
    assert.equal(forwarded.command, "FORWARD");
    assert.deepEqual(forwarded.payload, { throttle: 1, steering: 0 });

    const ack = await waitForMessage(
      controller,
      (msg) => msg.type === "ack" && msg.commandId === commandId
    );
    assert.match(ack.message, /control forwarded/);
  } finally {
    esp.close();
    controller.close();
  }
});

test("telemetry broadcast delivers esp telemetry to controller", async () => {
  const vehicleId = `test-telemetry-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;

  const esp = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(esp, { type: "identify", clientType: "esp", vehicleId });
    await waitForMessage(esp, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const telemetryPayload = {
      type: "telemetry",
      vehicleId,
      online: true,
      battery: 88,
      wifi: -58,
      latency: 42,
      cameraOn: true,
      driveState: {
        command: "FORWARD",
        throttle: 1,
        steering: 0,
      },
      lightOn: true,
      cameraTilt: 15,
      failure: null,
    };

    sendJson(esp, telemetryPayload);

    const received = await waitForMessage(
      controller,
      (msg) => msg.type === "telemetry" && msg.vehicleId === vehicleId
    );

    assert.equal(received.battery, telemetryPayload.battery);
    assert.equal(received.wifi, telemetryPayload.wifi);
    assert.equal(received.latency, telemetryPayload.latency);
    assert.equal(received.cameraOn, telemetryPayload.cameraOn);
    assert.deepEqual(received.driveState, telemetryPayload.driveState);
    assert.equal(received.lightOn, telemetryPayload.lightOn);
    assert.equal(received.cameraTilt, telemetryPayload.cameraTilt);
    assert.equal(received.failure, telemetryPayload.failure);
  } finally {
    esp.close();
    controller.close();
  }
});

test("ack responses include commandId for control and action", async () => {
  const vehicleId = `test-ack-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;

  const esp = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(esp, { type: "identify", clientType: "esp", vehicleId });
    await waitForMessage(esp, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const controlCommandId = `ctl-${Date.now()}`;
    sendJson(controller, {
      type: "control",
      vehicleId,
      source: "keyboard",
      command: "RIGHT",
      payload: { throttle: 0, steering: 1 },
      timestamp: Date.now(),
      commandId: controlCommandId,
    });

    const controlAck = await waitForMessage(
      controller,
      (msg) => msg.type === "ack" && msg.commandId === controlCommandId
    );
    assert.match(controlAck.message, /control forwarded/);

    const actionCommandId = `act-${Date.now()}`;
    sendJson(controller, {
      type: "action",
      vehicleId,
      source: "keyboard",
      action: "LIGHT_TOGGLE",
      timestamp: Date.now(),
      commandId: actionCommandId,
    });

    const actionAck = await waitForMessage(
      controller,
      (msg) => msg.type === "ack" && msg.commandId === actionCommandId
    );
    assert.match(actionAck.message, /action forwarded/);
  } finally {
    esp.close();
    controller.close();
  }
});

test("controller ownership lock allows only one driver", async () => {
  const vehicleId = `test-lock-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;

  const esp = await connectClient(url);
  const driverA = await connectClient(url);
  const driverB = await connectClient(url);

  try {
    sendJson(esp, { type: "identify", clientType: "esp", vehicleId });
    await waitForMessage(esp, (msg) => msg.type === "ack");

    sendJson(driverA, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(driverA, (msg) => msg.type === "ack");

    sendJson(driverB, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(driverB, (msg) => msg.type === "ack");

    const aCommandId = `ctl-a-${Date.now()}`;
    sendJson(driverA, {
      type: "control",
      vehicleId,
      source: "keyboard",
      command: "FORWARD",
      payload: { throttle: 1, steering: 0 },
      timestamp: Date.now(),
      commandId: aCommandId,
    });

    await waitForMessage(
      driverA,
      (msg) => msg.type === "ack" && msg.commandId === aCommandId
    );

    sendJson(driverB, {
      type: "control",
      vehicleId,
      source: "keyboard",
      command: "LEFT",
      payload: { throttle: 0, steering: -1 },
      timestamp: Date.now(),
      commandId: `ctl-b-${Date.now()}`,
    });

    const rejected = await waitForMessage(
      driverB,
      (msg) => msg.type === "error" && /lock/i.test(msg.message)
    );
    assert.match(rejected.message, /lock/i);
  } finally {
    esp.close();
    driverA.close();
    driverB.close();
  }
});

test("control/action rate limiting returns errors when exceeded", async () => {
  const vehicleId = `test-rate-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;

  const esp = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(esp, { type: "identify", clientType: "esp", vehicleId });
    await waitForMessage(esp, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    for (let i = 0; i < 7; i += 1) {
      sendJson(controller, {
        type: "control",
        vehicleId,
        source: "keyboard",
        command: i % 2 === 0 ? "FORWARD" : "RIGHT",
        payload: { throttle: 1, steering: i % 2 === 0 ? 0 : 1 },
        timestamp: Date.now(),
        commandId: `ctl-rate-${Date.now()}-${i}`,
      });
    }

    const rateError = await waitForMessage(
      controller,
      (msg) => msg.type === "error" && /rate limit/i.test(msg.message)
    );
    assert.match(rateError.message, /rate limit/i);
  } finally {
    esp.close();
    controller.close();
  }
});
