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
      CAMERA_LIVENESS_TIMEOUT_MS: "1500",
      VEHICLE_LIVENESS_TIMEOUT_MS: "1500",
      CAMERA_LIVENESS_CHECK_INTERVAL_MS: "100",
      WIFI_UPDATE_ACK_TIMEOUT_MS: "300",
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

function waitForBinaryMessage(ws, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for binary websocket message"));
    }, timeoutMs);

    const onMessage = (raw, isBinary) => {
      if (!isBinary) return;
      cleanup();
      resolve(Buffer.from(raw));
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
      wifiSsid: "FPV Lab",
      wifiGateway: "192.168.10.1",
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
    assert.equal(received.wifiSsid, telemetryPayload.wifiSsid);
    assert.equal(received.wifiGateway, telemetryPayload.wifiGateway);
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

test("binary camera frames relay without base64 encoding", async () => {
  const vehicleId = `test-camera-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(
      controller,
      (msg) => msg.type === "ack" && /Controller registered/.test(msg.message)
    );

    const jpegFrame = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]);
    const frameMeta = waitForMessage(
      controller,
      (msg) => msg.type === "camera_frame_meta"
    );
    const receivedFrame = waitForBinaryMessage(controller);
    const frameAck = waitForMessage(
      camera,
      (msg) => msg.type === "camera_frame_ack"
    );
    camera.send(jpegFrame, { binary: true });

    const metadata = await frameMeta;
    assert.deepEqual(await receivedFrame, jpegFrame);
    const ack = await frameAck;
    assert.equal(ack.accepted, true);
    assert.equal(ack.reason, "forwarded_to_controller");
    sendJson(controller, {
      type: "camera_frame_rendered",
      frameId: metadata.frameId,
      displayed: true,
    });
  } finally {
    camera.close();
    controller.close();
  }
});

test("binary camera frame acknowledgements use a monotonic frame ID", async () => {
  const vehicleId = `test-camera-frame-id-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const frameMeta = waitForMessage(
      controller,
      (msg) => msg.type === "camera_frame_meta" && msg.frameId === 1
    );
    const frameAck = waitForMessage(
      camera,
      (msg) => msg.type === "camera_frame_ack" && msg.frameId === 1
    );
    camera.send(
      Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]),
      { binary: true }
    );

    const metadata = await frameMeta;
    sendJson(controller, {
      type: "camera_frame_rendered",
      frameId: metadata.frameId,
      displayed: true,
    });
    const ack = await frameAck;
    assert.equal(ack.accepted, true);
    assert.equal(ack.frameId, 1);
  } finally {
    camera.close();
    controller.close();
  }
});

test("relay accepts the previous explicit camera frame header during rollout", async () => {
  const vehicleId = `test-camera-legacy-frame-id-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");
    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const header = Buffer.alloc(8);
    header.write("FPV1", 0, "ascii");
    header.writeUInt32BE(27, 4);
    camera.send(header, { binary: true });

    const frameMeta = waitForMessage(
      controller,
      (msg) => msg.type === "camera_frame_meta" && msg.frameId === 27
    );
    const frameAck = waitForMessage(
      camera,
      (msg) => msg.type === "camera_frame_ack" && msg.frameId === 27
    );
    camera.send(
      Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]),
      { binary: true }
    );

    const metadata = await frameMeta;
    sendJson(controller, {
      type: "camera_frame_rendered",
      frameId: metadata.frameId,
      displayed: true,
    });
    assert.equal((await frameAck).accepted, true);
  } finally {
    camera.close();
    controller.close();
  }
});

test("camera movement actions notify esp-cam before motion frames", async () => {
  const vehicleId = `test-camera-motion-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const esp = await connectClient(url);
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(esp, { type: "identify", clientType: "esp", vehicleId });
    await waitForMessage(esp, (msg) => msg.type === "ack");

    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const commandId = `camera-motion-${Date.now()}`;
    const cameraMotion = waitForMessage(
      camera,
      (msg) => msg.type === "camera_motion" && msg.action === "CAM_LEFT"
    );
    const espAction = waitForMessage(
      esp,
      (msg) => msg.type === "action" && msg.commandId === commandId
    );

    sendJson(controller, {
      type: "action",
      vehicleId,
      source: "keyboard",
      action: "CAM_LEFT",
      timestamp: Date.now(),
      commandId,
    });

    const motion = await cameraMotion;
    assert.equal(motion.holdMs, 1200);
    assert.equal(motion.vehicleId, vehicleId);
    assert.equal((await espAction).action, "CAM_LEFT");
  } finally {
    esp.close();
    camera.close();
    controller.close();
  }
});

test("camera stream profile reaches esp-cam without the vehicle ESP", async () => {
  const vehicleId = `test-camera-profile-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const profileMessage = waitForMessage(
      camera,
      (msg) => msg.type === "camera_stream_profile"
    );
    const commandId = `profile-${Date.now()}`;
    sendJson(controller, {
      type: "action",
      vehicleId,
      source: "system",
      action: "CAMERA_STREAM_PROFILE",
      payload: { profile: "realtime" },
      timestamp: Date.now(),
      commandId,
    });

    assert.equal((await profileMessage).profile, "realtime");
    const ack = await waitForMessage(
      controller,
      (msg) => msg.type === "ack" && msg.commandId === commandId
    );
    assert.match(ack.message, /realtime/);
  } finally {
    camera.close();
    controller.close();
  }
});

test("wifi update reaches the vehicle only after the camera confirms it was saved", async () => {
  const vehicleId = `test-shared-wifi-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const esp = await connectClient(url);
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(esp, { type: "identify", clientType: "esp", vehicleId });
    await waitForMessage(esp, (msg) => msg.type === "ack");
    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");
    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const commandId = `wifi-set-${Date.now()}`;
    const vehicleUpdate = waitForMessage(
      esp,
      (msg) => msg.type === "action" && msg.commandId === commandId
    );
    const cameraUpdate = waitForMessage(
      camera,
      (msg) => msg.type === "action" && msg.commandId === commandId
    );

    sendJson(controller, {
      type: "action",
      vehicleId,
      source: "system",
      action: "WIFI_SET",
      payload: { ssid: "New Network", password: "new-password" },
      timestamp: Date.now(),
      commandId,
    });

    const cameraMessage = await cameraUpdate;
    assert.deepEqual(cameraMessage.payload, {
      ssid: "New Network",
      password: "new-password",
    });

    let vehicleReceived = false;
    vehicleUpdate.then(() => {
      vehicleReceived = true;
    });
    await delay(50);
    assert.equal(vehicleReceived, false);

    const controllerAck = waitForMessage(
      controller,
      (msg) => msg.type === "ack" && msg.commandId === commandId
    );
    sendJson(camera, {
      type: "wifi_update_ack",
      vehicleId,
      commandId,
      ssid: "New Network",
      saved: true,
    });

    assert.deepEqual((await vehicleUpdate).payload, {
      ssid: "New Network",
      password: "new-password",
    });
    assert.match((await controllerAck).message, /cam.*saved/i);
  } finally {
    esp.close();
    camera.close();
    controller.close();
  }
});

test("camera stream status is sanitized and relayed to controllers", async () => {
  const vehicleId = `test-camera-stream-status-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const statusMessage = waitForMessage(
      controller,
      (msg) => msg.type === "camera_stream_status"
    );
    sendJson(camera, {
      type: "camera_stream_status",
      vehicleId,
      profile: "realtime",
      mode: "motion",
      fps: 12.4,
      ackMs: 87,
      frameBytes: 18400,
      jpegQuality: 23,
      rssi: -48,
      timeouts: 2,
      wifiSsid: "FPV Lab",
      wifiGateway: "192.168.10.1",
    });

    const status = await statusMessage;
    assert.equal(status.profile, "realtime");
    assert.equal(status.mode, "motion");
    assert.equal(status.fps, 12.4);
    assert.equal(status.ackMs, 87);
    assert.equal(status.frameBytes, 18400);
    assert.equal(status.wifiSsid, "FPV Lab");
    assert.equal(status.wifiGateway, "192.168.10.1");
  } finally {
    camera.close();
    controller.close();
  }
});

test("camera is marked offline when its connection stops sending data", async () => {
  const vehicleId = `test-camera-liveness-${Date.now()}`;
  const url = `ws://127.0.0.1:${serverPort}`;
  const camera = await connectClient(url);
  const controller = await connectClient(url);

  try {
    sendJson(camera, { type: "identify", clientType: "esp-cam", vehicleId });
    await waitForMessage(camera, (msg) => msg.type === "ack");

    sendJson(controller, {
      type: "identify",
      clientType: "web-controller",
      vehicleId,
    });
    await waitForMessage(controller, (msg) => msg.type === "ack");

    const offline = await waitForMessage(
      controller,
      (msg) =>
        msg.type === "camera_status" &&
        msg.vehicleId === vehicleId &&
        msg.online === false
    );

    assert.match(offline.message, /timed out/i);
  } finally {
    camera.close();
    controller.close();
  }
});

test("vehicle is marked offline when telemetry and status stop", async () => {
  const vehicleId = `test-vehicle-liveness-${Date.now()}`;
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

    const offline = await waitForMessage(
      controller,
      (msg) =>
        msg.type === "status" &&
        msg.vehicleId === vehicleId &&
        msg.state === "offline"
    );

    assert.match(offline.message, /timed out/i);
  } finally {
    esp.close();
    controller.close();
  }
});

test("wifi scan request and result travel between controller and esp", async () => {
  const vehicleId = `test-wifi-scan-${Date.now()}`;
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

    const commandId = `wifi-scan-${Date.now()}`;
    sendJson(controller, {
      type: "action",
      vehicleId,
      source: "system",
      action: "WIFI_SCAN",
      timestamp: Date.now(),
      commandId,
    });

    const forwarded = await waitForMessage(
      esp,
      (msg) => msg.type === "action" && msg.commandId === commandId
    );
    assert.equal(forwarded.action, "WIFI_SCAN");

    const resultPromise = waitForMessage(
      controller,
      (msg) => msg.type === "wifi_scan_result" && msg.requestId === commandId
    );
    sendJson(esp, {
      type: "wifi_scan_result",
      vehicleId,
      requestId: commandId,
      timestamp: Date.now(),
      networks: [
        { ssid: "Lab WiFi", rssi: -42, channel: 6, secure: true },
        { ssid: "Guest", rssi: -71, channel: 1, secure: false },
      ],
    });

    const result = await resultPromise;
    assert.equal(result.networks.length, 2);
    assert.deepEqual(result.networks[0], {
      ssid: "Lab WiFi",
      rssi: -42,
      channel: 6,
      secure: true,
    });
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
