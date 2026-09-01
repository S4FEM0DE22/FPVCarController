const { WebSocketServer, WebSocket } = require("ws");
const http = require("node:http");
const crypto = require("node:crypto");
const logger = require("./logger");

const PORT = process.env.PORT || process.env.WEBSITES_PORT || 8080;
const httpServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "fpv-car-relay",
        websocket: true,
        timestamp: Date.now(),
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, message: "Not found" }));
});
const wss = new WebSocketServer({ server: httpServer });

const VEHICLE_AUTH_TOKEN = process.env.VEHICLE_AUTH_TOKEN || "";
const CONTROLLER_AUTH_TOKEN = process.env.CONTROLLER_AUTH_TOKEN || "";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX_MESSAGES = Number(
  process.env.RATE_LIMIT_MAX_MESSAGES || 240
);
const CONTROL_ACTION_RATE_LIMIT_WINDOW_MS = Number(
  process.env.CONTROL_ACTION_RATE_LIMIT_WINDOW_MS || 5000
);
const CONTROL_ACTION_RATE_LIMIT_MAX_MESSAGES = Number(
  process.env.CONTROL_ACTION_RATE_LIMIT_MAX_MESSAGES || 60
);
const RATE_LIMIT_BLOCK_MS = Number(process.env.RATE_LIMIT_BLOCK_MS || 15000);
const RATE_LIMIT_CLEANUP_INTERVAL_MS = Number(
  process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS || 120000
);
const CAMERA_FRAME_MIN_INTERVAL_MS = Number(
  process.env.CAMERA_FRAME_MIN_INTERVAL_MS || 70
);
const CAMERA_FRAME_MAX_BYTES = Number(
  process.env.CAMERA_FRAME_MAX_BYTES || 200000
);
const CAMERA_CONTROLLER_MAX_BUFFERED_BYTES = Number(
  process.env.CAMERA_CONTROLLER_MAX_BUFFERED_BYTES || 128000
);
const CAMERA_RENDER_ACK_TIMEOUT_MS = Number(
  process.env.CAMERA_RENDER_ACK_TIMEOUT_MS || 900
);
const WIFI_UPDATE_ACK_TIMEOUT_MS = Number(
  process.env.WIFI_UPDATE_ACK_TIMEOUT_MS || 120000
);
const WIFI_ACTION_RETRY_INTERVAL_MS = Number(
  process.env.WIFI_ACTION_RETRY_INTERVAL_MS || 2000
);
const CAMERA_LIVENESS_TIMEOUT_MS = Number(
  process.env.CAMERA_LIVENESS_TIMEOUT_MS || 10000
);
const VEHICLE_LIVENESS_TIMEOUT_MS = Number(
  process.env.VEHICLE_LIVENESS_TIMEOUT_MS || 8000
);
const CAMERA_LIVENESS_CHECK_INTERVAL_MS = Number(
  process.env.CAMERA_LIVENESS_CHECK_INTERVAL_MS || 2000
);
const ALLOW_LOCALHOST_AUTH_BYPASS =
  String(process.env.ALLOW_LOCALHOST_AUTH_BYPASS || "true").toLowerCase() !==
  "false";
const CAMERA_MOTION_ACTIONS = new Set([
  "CAM_UP",
  "CAM_DOWN",
  "CAM_LEFT",
  "CAM_RIGHT",
  "CAM_RESET",
]);

const rateLimitByIp = new Map();
const controlActionRateLimitByKey = new Map();
let connectionSequence = 0;

function sanitizeIp(ip) {
  if (!ip) return "unknown";
  return String(ip).replace(/^::ffff:/, "");
}

function isRateLimited(ip) {
  const key = sanitizeIp(ip);
  const now = Date.now();
  const current = rateLimitByIp.get(key);

  if (current && current.blockedUntil && now < current.blockedUntil) {
    return {
      limited: true,
      retryAfterMs: current.blockedUntil - now,
      count: current.count,
    };
  }

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitByIp.set(key, {
      windowStart: now,
      count: 1,
      blockedUntil: 0,
      lastSeen: now,
    });
    return {
      limited: false,
      retryAfterMs: 0,
      count: 1,
    };
  }

  current.lastSeen = now;
  current.count += 1;

  if (current.count > RATE_LIMIT_MAX_MESSAGES) {
    current.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
    return {
      limited: true,
      retryAfterMs: RATE_LIMIT_BLOCK_MS,
      count: current.count,
    };
  }

  return {
    limited: false,
    retryAfterMs: 0,
    count: current.count,
  };
}

function isControlActionRateLimited(ip, vehicleId, messageType) {
  const key = `${sanitizeIp(ip)}:${vehicleId}:${messageType}`;
  const now = Date.now();
  const current = controlActionRateLimitByKey.get(key);

  if (!current || now - current.windowStart >= CONTROL_ACTION_RATE_LIMIT_WINDOW_MS) {
    controlActionRateLimitByKey.set(key, {
      windowStart: now,
      count: 1,
      lastSeen: now,
    });

    return {
      limited: false,
      count: 1,
    };
  }

  current.count += 1;
  current.lastSeen = now;

  return {
    limited: current.count > CONTROL_ACTION_RATE_LIMIT_MAX_MESSAGES,
    count: current.count,
  };
}

function isLoopbackIp(ip) {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

function readTokenFromHeaders(headers) {
  if (!headers) return "";
  const fromCustom =
    typeof headers["x-auth-token"] === "string" ? headers["x-auth-token"] : "";
  if (fromCustom) return fromCustom;

  const authorization =
    typeof headers.authorization === "string" ? headers.authorization : "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return bearerMatch ? bearerMatch[1] : "";
}

function readTokenFromQuery(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get("authToken") || parsed.searchParams.get("token") || "";
  } catch {
    return "";
  }
}

function readAuthToken(message, request) {
  if (typeof message?.authToken === "string") return message.authToken;
  if (typeof message?.token === "string") return message.token;
  const headerToken = readTokenFromHeaders(request?.headers);
  if (headerToken) return headerToken;
  const queryToken = readTokenFromQuery(request?.url);
  if (queryToken) return queryToken;
  return "";
}

function isTokenMatch(expected, actual) {
  if (!expected || !actual) return false;

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function isAuthorized(clientType, token, ip) {
  if (ALLOW_LOCALHOST_AUTH_BYPASS && isLoopbackIp(ip)) {
    return true;
  }

  const expectedToken =
    clientType === "esp" || clientType === "esp-cam"
      ? VEHICLE_AUTH_TOKEN
      : clientType === "web-controller"
      ? CONTROLLER_AUTH_TOKEN
      : "";

  if (!expectedToken) {
    return true;
  }

  return isTokenMatch(expectedToken, token);
}

function cleanupRateLimitEntries() {
  const now = Date.now();
  const maxIdleMs = Math.max(RATE_LIMIT_WINDOW_MS * 3, RATE_LIMIT_BLOCK_MS * 2);

  for (const [ip, state] of rateLimitByIp.entries()) {
    const expiredWindow = now - state.windowStart > maxIdleMs;
    const expiredBlock = !state.blockedUntil || state.blockedUntil <= now;
    const idle = !state.lastSeen || now - state.lastSeen > maxIdleMs;

    if ((expiredWindow && expiredBlock) || idle) {
      rateLimitByIp.delete(ip);
    }
  }

  const controlMaxIdleMs = CONTROL_ACTION_RATE_LIMIT_WINDOW_MS * 6;
  for (const [key, state] of controlActionRateLimitByKey.entries()) {
    const idle = !state.lastSeen || now - state.lastSeen > controlMaxIdleMs;
    const expiredWindow = now - state.windowStart > controlMaxIdleMs;

    if (idle || expiredWindow) {
      controlActionRateLimitByKey.delete(key);
    }
  }
}

const cleanupTimer = setInterval(
  cleanupRateLimitEntries,
  RATE_LIMIT_CLEANUP_INTERVAL_MS
);
cleanupTimer.unref();

/**
 * vehicleRegistry โครงสร้าง:
 * {
 *   "car-001": {
 *      esp: WebSocket | null,
 *      controllers: Set<WebSocket>,
 *      ownerControllerId: string | null,
 *      lastTelemetry: {...} | null,
 *      lastStatus: {...} | null
 *   }
 * }
 */
const vehicleRegistry = new Map();

function getVehicleEntry(vehicleId) {
  if (!vehicleRegistry.has(vehicleId)) {
    vehicleRegistry.set(vehicleId, {
      esp: null,
      camera: null,
      controllers: new Set(),
      ownerControllerId: null,
      lastTelemetry: null,
      lastStatus: null,
      lastCameraFrame: null,
      lastCameraFrameId: 0,
      lastCameraFrameAt: 0,
      pendingCameraFrameAcks: new Map(),
      pendingWifiChange: null,
      lastCameraStreamStatus: null,
      lastDeviceLogs: [],
    });
  }
  return vehicleRegistry.get(vehicleId);
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    return false;
  }
}

function safeSendBinary(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  if (ws.meta?.cameraFrameSending) return false;
  if (ws.bufferedAmount > CAMERA_CONTROLLER_MAX_BUFFERED_BYTES) return false;

  try {
    if (ws.meta) ws.meta.cameraFrameSending = true;
    ws.send(payload, { binary: true, compress: false }, () => {
      if (ws.meta) ws.meta.cameraFrameSending = false;
    });
    return true;
  } catch {
    if (ws.meta) ws.meta.cameraFrameSending = false;
    return false;
  }
}

function sendCameraFrameToController(ws, vehicleId, frameId, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  if (ws.meta?.cameraFrameAwaitingAck) return false;

  const metadataSent = safeSend(ws, {
    type: "camera_frame_meta",
    vehicleId,
    frameId,
    timestamp: Date.now(),
  });
  if (!metadataSent || !safeSendBinary(ws, payload)) return false;

  if (ws.meta) ws.meta.cameraFrameAwaitingAck = frameId;
  return true;
}

function broadcastToControllers(vehicleId, payload) {
  const entry = vehicleRegistry.get(vehicleId);
  if (!entry) return;

  for (const client of entry.controllers) {
    safeSend(client, payload);
  }
}

function broadcastBinaryToControllers(vehicleId, payload) {
  const entry = vehicleRegistry.get(vehicleId);
  if (!entry) return 0;

  let recipientCount = 0;

  for (const client of entry.controllers) {
    if (
      sendCameraFrameToController(
        client,
        vehicleId,
        entry.lastCameraFrameId,
        payload
      )
    ) {
      recipientCount += 1;
    }
  }

  return recipientCount;
}

function clearPendingCameraFrameAcks(entry) {
  if (!entry?.pendingCameraFrameAcks) return;
  for (const pending of entry.pendingCameraFrameAcks.values()) {
    clearTimeout(pending.timeoutId);
  }
  entry.pendingCameraFrameAcks.clear();
  for (const controller of entry.controllers) {
    if (controller.meta) controller.meta.cameraFrameAwaitingAck = null;
  }
}

function failPendingWifiChange(entry, message) {
  const pending = entry?.pendingWifiChange;
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  clearInterval(pending.retryId);
  entry.pendingWifiChange = null;
  broadcastToControllers(pending.vehicleId, {
    type: "error",
    commandId: pending.commandId,
    message,
  });
}

function sendWifiUpdateToVehicle(entry, pending) {
  const message = {
    type: "action",
    action: "WIFI_SET",
    commandId: pending.commandId,
    payload: { ssid: pending.ssid, password: pending.password },
  };
  return safeSend(entry.esp, message);
}

function retryWifiUpdateUntilAccepted(entry, pending) {
  clearInterval(pending.retryId);
  pending.retryId = setInterval(() => {
    if (entry.pendingWifiChange?.commandId !== pending.commandId) {
      clearInterval(pending.retryId);
      return;
    }
    if (!pending.accepted) sendWifiUpdateToVehicle(entry, pending);
  }, WIFI_ACTION_RETRY_INTERVAL_MS);
  pending.retryId.unref?.();
  return sendWifiUpdateToVehicle(entry, pending);
}

function scheduleWifiTransactionTimeout(entry, pending, timeoutMs, message) {
  clearTimeout(pending.timeoutId);
  pending.timeoutId = setTimeout(() => {
    if (entry.pendingWifiChange?.commandId !== pending.commandId) return;
    failPendingWifiChange(entry, message);
  }, timeoutMs);
  pending.timeoutId.unref?.();
}

function completePendingWifiChange(entry, pending) {
  clearTimeout(pending.timeoutId);
  clearInterval(pending.retryId);
  entry.pendingWifiChange = null;
  broadcastToControllers(pending.vehicleId, {
    type: "ack",
    commandId: pending.commandId,
    message: `Vehicle and camera are online through ${pending.ssid}`,
  });
  logger.info({
    event: "wifi_update.committed",
    vehicleId: entry.esp?.meta?.vehicleId || null,
    commandId: pending.commandId,
    ssid: pending.ssid,
  });
}

function createLegacyCommandId(prefix) {
  return `${prefix}-legacy-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function removeSocketFromRegistry(ws) {
  const meta = ws.meta;
  if (!meta || !meta.vehicleId || !meta.clientType) return;

  const entry = vehicleRegistry.get(meta.vehicleId);
  if (!entry) return;

  if (meta.clientType === "esp") {
    const wasActiveEsp = entry.esp === ws;
    if (wasActiveEsp) {
      entry.esp = null;

      broadcastToControllers(meta.vehicleId, {
        type: "status",
        vehicleId: meta.vehicleId,
        state: "offline",
        message: meta.espDisconnectMessage || "ESP disconnected",
      });
      entry.lastTelemetry = null;
      entry.lastStatus = null;
    }
  }

  if (meta.clientType === "esp-cam") {
    const wasActiveCamera = entry.camera === ws;
    if (wasActiveCamera) {
      entry.camera = null;
      entry.lastCameraFrame = null;
      entry.lastCameraFrameId = 0;
      entry.lastCameraFrameAt = 0;
      entry.lastCameraStreamStatus = null;
      clearPendingCameraFrameAcks(entry);

      broadcastToControllers(meta.vehicleId, {
        type: "camera_status",
        vehicleId: meta.vehicleId,
        online: false,
        message: meta.cameraDisconnectMessage || "ESP32-CAM disconnected",
        timestamp: Date.now(),
      });
    }
  }

  if (meta.clientType === "web-controller") {
    entry.controllers.delete(ws);

    if (entry.ownerControllerId && entry.ownerControllerId === meta.controllerId) {
      entry.ownerControllerId = null;

      if (entry.esp) {
        safeSend(entry.esp, {
          type: "control",
          vehicleId: meta.vehicleId,
          command: "STOP",
          source: "server-safety",
          payload: { throttle: 0, steering: 0 },
          commandId: createLegacyCommandId("safety-stop"),
        });
      }

      broadcastToControllers(meta.vehicleId, {
        type: "status",
        vehicleId: meta.vehicleId,
        state: entry.esp ? "idle" : "offline",
        message: "Controller lock released",
      });
    }
  }

  const noEsp = !entry.esp;
  const noCamera = !entry.camera;
  const noControllers = entry.controllers.size === 0;

  if (noEsp && noCamera && noControllers) {
    vehicleRegistry.delete(meta.vehicleId);
  }
}

function expireStaleDeviceConnections() {
  const now = Date.now();

  for (const [vehicleId, entry] of vehicleRegistry.entries()) {
    const esp = entry.esp;
    if (esp) {
      const lastSeenAt = Number(esp.meta?.lastSeenAt || 0);
      if (!lastSeenAt || now - lastSeenAt > VEHICLE_LIVENESS_TIMEOUT_MS) {
        if (esp.meta) {
          esp.meta.espDisconnectMessage = "ESP32 timed out";
        }
        logger.warn({
          event: "vehicle.liveness_timeout",
          vehicleId,
          connectionId: esp.meta?.connectionId || null,
          lastSeenAgeMs: lastSeenAt > 0 ? now - lastSeenAt : null,
        });
        esp.terminate();
      }
    }

    const camera = entry.camera;
    if (!camera) continue;

    const lastSeenAt = Number(camera.meta?.lastSeenAt || 0);
    if (lastSeenAt > 0 && now - lastSeenAt <= CAMERA_LIVENESS_TIMEOUT_MS) {
      continue;
    }

    if (camera.meta) {
      camera.meta.cameraDisconnectMessage = "ESP32-CAM timed out";
    }
    logger.warn({
      event: "camera.liveness_timeout",
      vehicleId,
      connectionId: camera.meta?.connectionId || null,
      lastSeenAgeMs: lastSeenAt > 0 ? now - lastSeenAt : null,
    });
    camera.terminate();
  }
}

const deviceLivenessTimer = setInterval(
  expireStaleDeviceConnections,
  CAMERA_LIVENESS_CHECK_INTERVAL_MS
);
deviceLivenessTimer.unref();

logger.info({
  event: "server.started",
  port: PORT,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMaxMessages: RATE_LIMIT_MAX_MESSAGES,
  rateLimitBlockMs: RATE_LIMIT_BLOCK_MS,
  controlActionRateLimitWindowMs: CONTROL_ACTION_RATE_LIMIT_WINDOW_MS,
  controlActionRateLimitMaxMessages: CONTROL_ACTION_RATE_LIMIT_MAX_MESSAGES,
  cameraFrameMinIntervalMs: CAMERA_FRAME_MIN_INTERVAL_MS,
  cameraFrameMaxBytes: CAMERA_FRAME_MAX_BYTES,
  cameraControllerMaxBufferedBytes: CAMERA_CONTROLLER_MAX_BUFFERED_BYTES,
  cameraRenderAckTimeoutMs: CAMERA_RENDER_ACK_TIMEOUT_MS,
  wifiUpdateAckTimeoutMs: WIFI_UPDATE_ACK_TIMEOUT_MS,
  wifiActionRetryIntervalMs: WIFI_ACTION_RETRY_INTERVAL_MS,
  cameraLivenessTimeoutMs: CAMERA_LIVENESS_TIMEOUT_MS,
  vehicleLivenessTimeoutMs: VEHICLE_LIVENESS_TIMEOUT_MS,
  cameraLivenessCheckIntervalMs: CAMERA_LIVENESS_CHECK_INTERVAL_MS,
  controllerAuthEnabled: Boolean(CONTROLLER_AUTH_TOKEN),
  vehicleAuthEnabled: Boolean(VEHICLE_AUTH_TOKEN),
  allowLocalhostAuthBypass: ALLOW_LOCALHOST_AUTH_BYPASS,
});

wss.on("connection", (ws, request) => {
  const ip = sanitizeIp(request?.socket?.remoteAddress);
  connectionSequence = (connectionSequence + 1) % Number.MAX_SAFE_INTEGER;
  const connectionId = `conn-${connectionSequence.toString(36)}-${Date.now().toString(36)}`;

  ws.meta = {
    connectionId,
    clientType: null,
    vehicleId: null,
    controllerId: null,
    ip,
    lastCameraFrameAt: 0,
    cameraFrameSending: false,
    cameraFrameAwaitingAck: null,
    cameraFrameSequence: 0,
    legacyCameraFrameId: null,
    lastSeenAt: Date.now(),
    cameraDisconnectMessage: null,
    espDisconnectMessage: null,
  };

  logger.info({
    event: "connection.open",
    ip,
    connectionId,
    userAgent: request?.headers?.["user-agent"] || null,
  });

  ws.on("message", (raw, isBinary) => {
    ws.meta.lastSeenAt = Date.now();

    if (isBinary) {
      const vehicleId = ws.meta.vehicleId;
      if (ws.meta.clientType !== "esp-cam" || !vehicleId) {
        safeSend(ws, {
          type: "error",
          message: "Only an identified esp-cam can send binary frames",
        });
        return;
      }

      if (
        raw.length === 8 &&
        raw[0] === 0x46 &&
        raw[1] === 0x50 &&
        raw[2] === 0x56 &&
        raw[3] === 0x31
      ) {
        ws.meta.legacyCameraFrameId = raw.readUInt32BE(4);
        return;
      }

      const legacyFrameId = ws.meta.legacyCameraFrameId;
      ws.meta.legacyCameraFrameId = null;
      const frameId = legacyFrameId ?? ++ws.meta.cameraFrameSequence;
      if (legacyFrameId !== null) {
        ws.meta.cameraFrameSequence = legacyFrameId;
      }

      const isJpeg =
        raw.length >= 4 &&
        raw[0] === 0xff &&
        raw[1] === 0xd8 &&
        raw[raw.length - 2] === 0xff &&
        raw[raw.length - 1] === 0xd9;

      if (!isJpeg || raw.length > CAMERA_FRAME_MAX_BYTES) {
        safeSend(ws, {
          type: "camera_frame_ack",
          frameId,
          accepted: false,
          reason: !isJpeg ? "invalid_jpeg" : "frame_too_large",
          timestamp: Date.now(),
        });
        logger.warn({
          event: "camera_frame.invalid_binary",
          ip,
          connectionId,
          vehicleId,
          bytes: raw.length,
          isJpeg,
        });
        return;
      }

      const now = Date.now();
      if (now - ws.meta.lastCameraFrameAt < CAMERA_FRAME_MIN_INTERVAL_MS) {
        safeSend(ws, {
          type: "camera_frame_ack",
          frameId,
          accepted: false,
          reason: "frame_interval",
          timestamp: now,
        });
        return;
      }
      ws.meta.lastCameraFrameAt = now;

      const entry = getVehicleEntry(vehicleId);
      const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      entry.lastCameraFrame = frame;
      entry.lastCameraFrameId = frameId;
      entry.lastCameraFrameAt = now;
      const recipientCount = broadcastBinaryToControllers(vehicleId, frame);

      if (recipientCount === 0) {
        safeSend(ws, {
          type: "camera_frame_ack",
          frameId,
          accepted: false,
          reason: "no_ready_controller",
          timestamp: now,
        });
        return;
      }

      const timeoutId = setTimeout(() => {
        const pending = entry.pendingCameraFrameAcks.get(frameId);
        if (!pending) return;
        entry.pendingCameraFrameAcks.delete(frameId);
      }, CAMERA_RENDER_ACK_TIMEOUT_MS);
      timeoutId.unref?.();
      entry.pendingCameraFrameAcks.set(frameId, { timeoutId });
      safeSend(ws, {
        type: "camera_frame_ack",
        frameId,
        accepted: true,
        reason: "forwarded_to_controller",
        timestamp: now,
      });
      return;
    }

    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch (error) {
      safeSend(ws, {
        type: "error",
        message: "Invalid JSON",
      });
      logger.warn({
        event: "message.invalid_json",
        ip,
        connectionId,
      });
      return;
    }

    // This ACK is high-frequency stream flow control, not a user command.
    if (data.type === "camera_frame_rendered") {
      const { clientType, vehicleId } = ws.meta;
      const frameId = Number(data.frameId);
      if (
        clientType !== "web-controller" ||
        !vehicleId ||
        !Number.isSafeInteger(frameId) ||
        frameId <= 0
      ) {
        return;
      }

      const entry = getVehicleEntry(vehicleId);
      if (ws.meta.cameraFrameAwaitingAck === frameId) {
        ws.meta.cameraFrameAwaitingAck = null;
      }

      const pending = entry.pendingCameraFrameAcks.get(frameId);
      if (!pending) return;

      clearTimeout(pending.timeoutId);
      entry.pendingCameraFrameAcks.delete(frameId);
      return;
    }

    const rate = isRateLimited(connectionId);
    if (rate.limited) {
      safeSend(ws, {
        type: "error",
        message: `Rate limit exceeded. Retry in ${Math.ceil(
          Math.max(0, rate.retryAfterMs) / 1000
        )}s`,
      });
      logger.warn({
        event: "rate_limit.exceeded",
        ip,
        connectionId,
        retryAfterMs: rate.retryAfterMs,
        messageCount: rate.count,
      });
      return;
    }

    // 1) IDENTIFY
    if (data.type === "identify") {
      const clientType = data.clientType;
      const vehicleId = data.vehicleId;
      const authToken = readAuthToken(data, request);

      if (!clientType || !vehicleId) {
        safeSend(ws, {
          type: "error",
          message: "identify requires clientType and vehicleId",
        });
        logger.warn({
          event: "identify.missing_fields",
          ip,
          connectionId,
          clientType,
          vehicleId,
        });
        return;
      }

      if (!isAuthorized(clientType, authToken, ip)) {
        safeSend(ws, {
          type: "error",
          message: "Authentication failed",
        });
        logger.warn({
          event: "identify.auth_failed",
          ip,
          connectionId,
          clientType,
          vehicleId,
          tokenProvided: Boolean(authToken),
        });
        return;
      }

      ws.meta.clientType = clientType;
      ws.meta.vehicleId = vehicleId;
      ws.meta.controllerId = clientType === "web-controller" ? connectionId : null;

      const entry = getVehicleEntry(vehicleId);

      if (clientType === "esp") {
        const previousEsp = entry.esp;
        entry.esp = ws;
        if (previousEsp && previousEsp !== ws) {
          previousEsp.terminate();
        }

        safeSend(ws, {
          type: "ack",
          message: `ESP registered for ${vehicleId}`,
        });

        broadcastToControllers(vehicleId, {
          type: "status",
          vehicleId,
          state: "online",
          message: "ESP connected",
        });

        if (entry.lastTelemetry) {
          safeSend(ws, {
            type: "ack",
            message: "telemetry cache ready",
          });
        }
      } else if (clientType === "esp-cam") {
        const previousCamera = entry.camera;
        clearPendingCameraFrameAcks(entry);
        entry.camera = ws;
        if (previousCamera && previousCamera !== ws) {
          previousCamera.terminate();
        }

        safeSend(ws, {
          type: "ack",
          message: `ESP32-CAM registered for ${vehicleId}`,
        });

        broadcastToControllers(vehicleId, {
          type: "camera_status",
          vehicleId,
          online: true,
          message: "ESP32-CAM connected",
          timestamp: Date.now(),
        });
      } else if (clientType === "web-controller") {
        entry.controllers.add(ws);

        safeSend(ws, {
          type: "ack",
          message: `Controller registered for ${vehicleId}`,
        });

        if (entry.lastTelemetry) {
          safeSend(ws, entry.lastTelemetry);
        }

        if (entry.lastStatus) {
          safeSend(ws, entry.lastStatus);
        }

        if (
          entry.camera &&
          entry.lastCameraFrame &&
          Date.now() - entry.lastCameraFrameAt <= CAMERA_RENDER_ACK_TIMEOUT_MS
        ) {
          if (Buffer.isBuffer(entry.lastCameraFrame)) {
            sendCameraFrameToController(
              ws,
              vehicleId,
              entry.lastCameraFrameId,
              entry.lastCameraFrame
            );
          } else {
            safeSend(ws, entry.lastCameraFrame);
          }
        }

        if (entry.camera && entry.lastCameraStreamStatus) {
          safeSend(ws, entry.lastCameraStreamStatus);
        }

        for (const deviceLog of entry.lastDeviceLogs) {
          safeSend(ws, deviceLog);
        }

        safeSend(ws, {
          type: "status",
          vehicleId,
          state: entry.esp ? "online" : "offline",
          message: entry.esp ? "ESP available" : "ESP not connected",
        });

        safeSend(ws, {
          type: "camera_status",
          vehicleId,
          online: Boolean(entry.camera),
          message: entry.camera ? "ESP32-CAM available" : "ESP32-CAM not connected",
          timestamp: Date.now(),
        });
      } else {
        safeSend(ws, {
          type: "error",
          message: `Unsupported clientType: ${clientType}`,
        });
        logger.warn({
          event: "identify.unsupported_client",
          ip,
          connectionId,
          clientType,
          vehicleId,
        });
      }

      logger.info({
        event: "identify.success",
        ip,
        connectionId,
        clientType,
        vehicleId,
      });
      return;
    }

    // ถ้ายังไม่ identify มาก่อน จะไม่ให้ทำอย่างอื่น
    if (!ws.meta.clientType || !ws.meta.vehicleId) {
      safeSend(ws, {
        type: "error",
        message: "Please identify first",
      });
      logger.warn({
        event: "message.before_identify",
        ip,
        connectionId,
      });
      return;
    }

    const { clientType, vehicleId } = ws.meta;
    const entry = getVehicleEntry(vehicleId);

    // 2) PING/PONG
    if (data.type === "ping") {
      safeSend(ws, {
        type: "pong",
        timestamp: data.timestamp,
      });
      return;
    }

    if (data.type === "wifi_update_status") {
      const pending = entry.pendingWifiChange;
      const commandId =
        typeof data.commandId === "string" ? data.commandId.trim() : "";
      if (
        clientType !== "esp" ||
        !pending ||
        !commandId ||
        pending.commandId !== commandId ||
        data.ssid !== pending.ssid
      ) return;

      pending.accepted = true;
      clearInterval(pending.retryId);
      broadcastToControllers(pending.vehicleId, data);

      const state = typeof data.state === "string" ? data.state : "";
      if (state === "success" && data.ok === true) {
        completePendingWifiChange(entry, pending);
      } else if (state === "failed" || data.ok === false) {
        failPendingWifiChange(
          entry,
          data.message || "Vehicle restored the previous WiFi"
        );
      }

      logger.info({
        event: "wifi_update.status",
        ip,
        connectionId,
        vehicleId,
        commandId,
        state,
        ok: data.ok === true,
      });
      return;
    }

    // 3) CONTROL จากเว็บ -> ส่งให้ ESP
    if (data.type === "control") {
      const commandId =
        typeof data.commandId === "string" && data.commandId.trim().length > 0
          ? data.commandId
          : createLegacyCommandId("ctl");

      if (clientType !== "web-controller") {
        safeSend(ws, {
          type: "error",
          commandId,
          message: "Only web-controller can send control",
        });
        return;
      }

      if (!entry.esp) {
        safeSend(ws, {
          type: "error",
          commandId,
          message: "ESP not connected",
        });
        return;
      }

      if (!entry.ownerControllerId) {
        entry.ownerControllerId = ws.meta.controllerId;
      }

      if (entry.ownerControllerId !== ws.meta.controllerId) {
        safeSend(ws, {
          type: "error",
          commandId,
          message: "Controller lock is held by another client",
        });
        logger.warn({
          event: "control.lock_denied",
          ip,
          connectionId,
          vehicleId,
          ownerControllerId: entry.ownerControllerId,
          requesterControllerId: ws.meta.controllerId,
        });
        return;
      }

      const controlRate = isControlActionRateLimited(ip, vehicleId, "control");
      if (controlRate.limited) {
        safeSend(ws, {
          type: "error",
          commandId,
          message: "Control rate limit exceeded",
        });
        logger.warn({
          event: "control.rate_limit.exceeded",
          ip,
          connectionId,
          vehicleId,
          messageCount: controlRate.count,
        });
        return;
      }

      const forwarded = {
        ...data,
        commandId,
      };

      safeSend(entry.esp, forwarded);
      safeSend(ws, {
        type: "ack",
        commandId,
        message: `control forwarded: ${data.command}`,
      });

      logger.info({
        event: "control.forwarded",
        ip,
        connectionId,
        vehicleId,
        clientType,
        command: data.command,
        commandId,
      });
      return;
    }

    // 4) ACTION จากเว็บ -> ส่งให้ ESP
    if (data.type === "action") {
      const commandId =
        typeof data.commandId === "string" && data.commandId.trim().length > 0
          ? data.commandId
          : createLegacyCommandId("act");

      if (clientType !== "web-controller") {
        safeSend(ws, {
          type: "error",
          commandId,
          message: "Only web-controller can send action",
        });
        return;
      }

      if (data.action === "CAMERA_STREAM_PROFILE") {
        const profile = data.payload?.profile;
        if (!["realtime", "balanced", "quality"].includes(profile)) {
          safeSend(ws, {
            type: "error",
            commandId,
            message: "Invalid camera stream profile",
          });
          return;
        }

        if (!entry.camera) {
          safeSend(ws, {
            type: "error",
            commandId,
            message: "ESP32-CAM not connected",
          });
          return;
        }

        safeSend(entry.camera, {
          type: "camera_stream_profile",
          vehicleId,
          profile,
          timestamp: Date.now(),
        });
        safeSend(ws, {
          type: "ack",
          commandId,
          message: `camera stream profile forwarded: ${profile}`,
        });
        logger.info({
          event: "camera_stream_profile.forwarded",
          ip,
          connectionId,
          vehicleId,
          profile,
          commandId,
        });
        return;
      }

      if (!entry.esp) {
        safeSend(ws, {
          type: "error",
          commandId,
          message: "ESP not connected",
        });
        return;
      }

      // Allow any controller to send actions (takeover ownership if needed)
      entry.ownerControllerId = ws.meta.controllerId;

      const actionRate = isControlActionRateLimited(ip, vehicleId, "action");
      if (actionRate.limited) {
        safeSend(ws, {
          type: "error",
          commandId,
          message: "Action rate limit exceeded",
        });
        logger.warn({
          event: "action.rate_limit.exceeded",
          ip,
          connectionId,
          vehicleId,
          messageCount: actionRate.count,
        });
        return;
      }

      const forwarded = {
        ...data,
        commandId,
      };

      if (data.action === "WIFI_SET") {
        const ssid =
          typeof data.payload?.ssid === "string"
            ? data.payload.ssid.trim().slice(0, 64)
            : "";
        const password =
          typeof data.payload?.password === "string"
            ? data.payload.password.slice(0, 96)
            : "";

        if (!ssid) {
          safeSend(ws, {
            type: "error",
            commandId,
            message: "WiFi update requires an SSID",
          });
          return;
        }
        if (entry.pendingWifiChange) {
          safeSend(ws, {
            type: "error",
            commandId,
            message: "A WiFi update is already in progress",
          });
          return;
        }
        const pending = {
          commandId,
          vehicleId,
          ssid,
          password,
          accepted: false,
          timeoutId: null,
          retryId: null,
        };
        entry.pendingWifiChange = pending;
        scheduleWifiTransactionTimeout(
          entry,
          pending,
          WIFI_UPDATE_ACK_TIMEOUT_MS,
          "Vehicle did not finish the WiFi update in time"
        );

        retryWifiUpdateUntilAccepted(entry, pending);

        logger.info({
          event: "wifi_update.sent",
          ip,
          connectionId,
          vehicleId,
          commandId,
          ssid,
        });
        return;
      }

      if (CAMERA_MOTION_ACTIONS.has(data.action)) {
        safeSend(entry.camera, {
          type: "camera_motion",
          vehicleId,
          action: data.action,
          holdMs: 1200,
          timestamp: Date.now(),
        });
      }
      if (
        data.action === "WIFI_PORTAL_OPEN" ||
        data.action === "NETWORK_RECONNECT"
      ) {
        safeSend(entry.camera, forwarded);
      }
      safeSend(entry.esp, forwarded);
      safeSend(ws, {
        type: "ack",
        commandId,
        message: `action forwarded: ${data.action}`,
      });

      logger.info({
        event: "action.forwarded",
        ip,
        connectionId,
        vehicleId,
        clientType,
        action: data.action,
        commandId,
      });
      return;
    }

    // 5) TELEMETRY จาก ESP -> broadcast ไปเว็บ
    if (data.type === "camera_frame") {
      if (clientType !== "esp-cam") {
        safeSend(ws, {
          type: "error",
          message: "Only esp-cam can send camera_frame",
        });
        return;
      }

      if (typeof data.data !== "string" || data.data.length === 0) {
        safeSend(ws, {
          type: "error",
          message: "camera_frame requires base64 data",
        });
        return;
      }

      const frame = {
        type: "camera_frame",
        vehicleId,
        format: data.format || "jpeg",
        data: data.data,
        width: data.width || null,
        height: data.height || null,
        timestamp: data.timestamp || Date.now(),
      };

      entry.lastCameraFrame = frame;
      broadcastToControllers(vehicleId, frame);
      return;
    }

    if (data.type === "device_log") {
      if (clientType !== "esp" && clientType !== "esp-cam") {
        safeSend(ws, {
          type: "error",
          message: "Only ESP devices can send device_log",
        });
        return;
      }

      const message =
        typeof data.message === "string" ? data.message.trim().slice(0, 240) : "";
      if (!message) {
        safeSend(ws, {
          type: "error",
          message: "device_log requires message",
        });
        return;
      }

      const source =
        typeof data.source === "string" && data.source.trim()
          ? data.source.trim().slice(0, 24)
          : clientType === "esp-cam"
          ? "esp32-cam"
          : "esp32";
      const level =
        typeof data.level === "string" && data.level.trim()
          ? data.level.trim().slice(0, 16)
          : "info";

      const deviceLog = {
        type: "device_log",
        vehicleId,
        source,
        level,
        message,
        timestamp: data.timestamp || Date.now(),
      };

      entry.lastDeviceLogs = [deviceLog, ...entry.lastDeviceLogs].slice(0, 80);
      broadcastToControllers(vehicleId, deviceLog);
      return;
    }

    if (data.type === "camera_stream_status") {
      if (clientType !== "esp-cam") {
        safeSend(ws, {
          type: "error",
          message: "Only esp-cam can send camera_stream_status",
        });
        return;
      }

      const profile = ["realtime", "balanced", "quality"].includes(data.profile)
        ? data.profile
        : "balanced";
      const cameraStreamStatus = {
        type: "camera_stream_status",
        vehicleId,
        profile,
        mode: data.mode === "motion" ? "motion" : "idle",
        fps: Math.max(0, Math.min(30, Number(data.fps) || 0)),
        ackMs: Math.max(0, Math.min(10000, Number(data.ackMs) || 0)),
        frameBytes: Math.max(0, Math.min(CAMERA_FRAME_MAX_BYTES, Number(data.frameBytes) || 0)),
        jpegQuality: Math.max(0, Math.min(63, Number(data.jpegQuality) || 0)),
        rssi: Math.max(-120, Math.min(0, Number(data.rssi) || -120)),
        timeouts: Math.max(0, Number(data.timeouts) || 0),
        wifiSsid:
          typeof data.wifiSsid === "string"
            ? data.wifiSsid.trim().slice(0, 64)
            : "",
        wifiGateway:
          typeof data.wifiGateway === "string"
            ? data.wifiGateway.trim().slice(0, 45)
            : "",
        timestamp: Date.now(),
      };

      entry.lastCameraStreamStatus = cameraStreamStatus;
      broadcastToControllers(vehicleId, cameraStreamStatus);
      return;
    }

    if (data.type === "wifi_scan_result") {
      if (clientType !== "esp") {
        safeSend(ws, {
          type: "error",
          message: "Only esp can send wifi_scan_result",
        });
        return;
      }

      const networks = Array.isArray(data.networks)
        ? data.networks
            .slice(0, 32)
            .map((network) => ({
              ssid:
                typeof network?.ssid === "string"
                  ? network.ssid.trim().slice(0, 32)
                  : "",
              rssi: Number.isFinite(Number(network?.rssi))
                ? Math.max(-120, Math.min(0, Math.round(Number(network.rssi))))
                : -100,
              channel: Number.isFinite(Number(network?.channel))
                ? Math.max(0, Math.min(14, Math.round(Number(network.channel))))
                : 0,
              secure: Boolean(network?.secure),
            }))
            .filter((network) => network.ssid)
        : [];

      broadcastToControllers(vehicleId, {
        type: "wifi_scan_result",
        vehicleId,
        networks,
        ...(typeof data.error === "string" && data.error.trim()
          ? { error: data.error.trim().slice(0, 160) }
          : {}),
        ...(typeof data.requestId === "string" && data.requestId.trim()
          ? { requestId: data.requestId.trim().slice(0, 96) }
          : {}),
        timestamp: data.timestamp || Date.now(),
      });

      logger.info({
        event: "wifi_scan.received",
        ip,
        connectionId,
        vehicleId,
        networkCount: networks.length,
      });
      return;
    }

    if (data.type === "telemetry") {
      if (clientType !== "esp") {
        safeSend(ws, {
          type: "error",
          message: "Only esp can send telemetry",
        });
        return;
      }

      const telemetry = {
        ...data,
        wifiSsid:
          typeof data.wifiSsid === "string"
            ? data.wifiSsid.trim().slice(0, 64)
            : "",
        wifiGateway:
          typeof data.wifiGateway === "string"
            ? data.wifiGateway.trim().slice(0, 45)
            : "",
      };
      entry.lastTelemetry = telemetry;
      broadcastToControllers(vehicleId, telemetry);

      logger.info({
        event: "telemetry.received",
        ip,
        connectionId,
        vehicleId,
        clientType,
      });
      return;
    }

    // 6) STATUS จาก ESP -> broadcast ไปเว็บ
    if (data.type === "status") {
      if (clientType !== "esp") {
        safeSend(ws, {
          type: "error",
          message: "Only esp can send status",
        });
        return;
      }

      entry.lastStatus = data;
      broadcastToControllers(vehicleId, data);

      logger.info({
        event: "status.received",
        ip,
        connectionId,
        vehicleId,
        clientType,
        state: data.state,
      });
      return;
    }

    safeSend(ws, {
      type: "error",
      message: `Unsupported message type: ${data.type}`,
    });
    logger.warn({
      event: "message.unsupported_type",
      ip,
      connectionId,
      vehicleId,
      clientType,
      type: data.type,
    });
  });

  ws.on("close", () => {
    logger.info({
      event: "connection.close",
      ip,
      connectionId,
      clientType: ws.meta?.clientType,
      vehicleId: ws.meta?.vehicleId,
    });
    removeSocketFromRegistry(ws);
  });

  ws.on("error", (error) => {
    logger.error({
      event: "connection.error",
      ip,
      connectionId,
      clientType: ws.meta?.clientType,
      vehicleId: ws.meta?.vehicleId,
      message: error.message,
    });
  });
});

httpServer.listen(PORT, () => {
  logger.info({
    event: "http_server.listening",
    port: PORT,
  });
});
