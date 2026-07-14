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
const ALLOW_LOCALHOST_AUTH_BYPASS =
  String(process.env.ALLOW_LOCALHOST_AUTH_BYPASS || "true").toLowerCase() !==
  "false";

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

function broadcastToControllers(vehicleId, payload) {
  const entry = vehicleRegistry.get(vehicleId);
  if (!entry) return;

  for (const client of entry.controllers) {
    safeSend(client, payload);
  }
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
    if (entry.esp === ws) {
      entry.esp = null;
    }

    broadcastToControllers(meta.vehicleId, {
      type: "status",
      vehicleId: meta.vehicleId,
      state: "offline",
      message: "ESP disconnected",
    });
  }

  if (meta.clientType === "esp-cam") {
    if (entry.camera === ws) {
      entry.camera = null;
    }

    broadcastToControllers(meta.vehicleId, {
      type: "camera_status",
      vehicleId: meta.vehicleId,
      online: false,
      message: "ESP32-CAM disconnected",
      timestamp: Date.now(),
    });
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

logger.info({
  event: "server.started",
  port: PORT,
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitMaxMessages: RATE_LIMIT_MAX_MESSAGES,
  rateLimitBlockMs: RATE_LIMIT_BLOCK_MS,
  controlActionRateLimitWindowMs: CONTROL_ACTION_RATE_LIMIT_WINDOW_MS,
  controlActionRateLimitMaxMessages: CONTROL_ACTION_RATE_LIMIT_MAX_MESSAGES,
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
  };

  logger.info({
    event: "connection.open",
    ip,
    connectionId,
    userAgent: request?.headers?.["user-agent"] || null,
  });

  ws.on("message", (raw) => {
    const rate = isRateLimited(ip);
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
        entry.esp = ws;

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
        entry.camera = ws;

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

        if (entry.lastCameraFrame) {
          safeSend(ws, entry.lastCameraFrame);
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

    if (data.type === "telemetry") {
      if (clientType !== "esp") {
        safeSend(ws, {
          type: "error",
          message: "Only esp can send telemetry",
        });
        return;
      }

      entry.lastTelemetry = data;
      broadcastToControllers(vehicleId, data);

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
