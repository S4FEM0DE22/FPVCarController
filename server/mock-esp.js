const WebSocket = require("ws");

const WS_URL = process.env.MOCK_WS_URL || "ws://localhost:8080";
const ws = new WebSocket(WS_URL);
const MOCK_ESP_AUTH_TOKEN = process.env.MOCK_ESP_AUTH_TOKEN || "";

const CONTROL_COMMANDS = new Set([
  "FORWARD",
  "BACKWARD",
  "LEFT",
  "RIGHT",
  "STOP",
  "FORWARD_LEFT",
  "FORWARD_RIGHT",
  "BACKWARD_LEFT",
  "BACKWARD_RIGHT",
]);

const ACTION_COMMANDS = new Set([
  "LIGHT_TOGGLE",
  "CAM_UP",
  "CAM_DOWN",
  "CAM_RESET",
  "CAMERA_TOGGLE",
  "HORN",
  "PROFILE_APPLY",
  "WIFI_SET",
  "NETWORK_RECONNECT",
  "REBOOT",
  "WIFI_PORTAL_OPEN",
]);

const VEHICLE_ID = "car-001";
const TILT_MIN = 0;
const TILT_MAX = 90;
const CAMERA_STEP_DEG = 6;

const SIM = {
  telemetryEveryMs: 500,
  statusEveryMs: 1500,
  batteryEveryMs: 1000,
  networkBaseLatencyMs: 35,
  networkJitterMs: 140,
  networkDropChance: 0.03,
  failureTickChance: 0.05,
  failureDurationMinMs: 4000,
  failureDurationMaxMs: 10000,
};

const DEFAULT_PROFILE = {
  name: "Balanced",
  driveScale: 1,
  steeringScale: 1,
  cameraStepDeg: 6,
  throttleExponent: 1,
  note: "Stable default mapping for general driving.",
};

const failureCatalog = [
  {
    type: "drive_fault",
    message: "Drive motor fault detected",
    effect: (state) => {
      state.drive.command = "STOP";
      state.drive.throttle = 0;
      state.drive.steering = 0;
    },
  },
  {
    type: "camera_servo_stuck",
    message: "Camera servo stuck",
    effect: () => {
      // Keeps the failure marker active; tilt actions are ignored while active.
    },
  },
  {
    type: "battery_protection",
    message: "Battery protection active",
    effect: (state) => {
      state.drive.command = "STOP";
      state.drive.throttle = 0;
      state.drive.steering = 0;
      state.lightOn = false;
    },
  },
];

const vehicle = {
  online: true,
  drive: {
    throttle: 0,
    steering: 0,
    command: "STOP",
  },
  lightOn: false,
  cameraOn: true,
  cameraTilt: 45,
  battery: 100,
  wifi: -48,
  behaviorProfile: DEFAULT_PROFILE,
  failure: {
    active: false,
    type: null,
    message: "",
    untilTs: 0,
  },
};

let telemetryTimer = null;
let statusTimer = null;
let batteryTimer = null;
let failureTimer = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeProfile(input) {
  const profile = input && typeof input === "object" ? input : {};

  return {
    name: typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : DEFAULT_PROFILE.name,
    driveScale: clamp(Number(profile.driveScale ?? DEFAULT_PROFILE.driveScale), 0.3, 2),
    steeringScale: clamp(Number(profile.steeringScale ?? DEFAULT_PROFILE.steeringScale), 0.3, 2),
    cameraStepDeg: clamp(Number(profile.cameraStepDeg ?? DEFAULT_PROFILE.cameraStepDeg), 1, 12),
    throttleExponent: clamp(Number(profile.throttleExponent ?? DEFAULT_PROFILE.throttleExponent), 0.5, 2.5),
    note: typeof profile.note === "string" && profile.note.trim() ? profile.note.trim() : DEFAULT_PROFILE.note,
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomLatencyMs() {
  return SIM.networkBaseLatencyMs + randomInt(0, SIM.networkJitterMs);
}

function withNetworkDelay(task) {
  if (Math.random() < SIM.networkDropChance) return;
  setTimeout(task, randomLatencyMs());
}

function isFailureActive() {
  if (!vehicle.failure.active) return false;

  if (Date.now() >= vehicle.failure.untilTs) {
    vehicle.failure.active = false;
    vehicle.failure.type = null;
    vehicle.failure.message = "";
    vehicle.failure.untilTs = 0;
    return false;
  }

  return true;
}

function sendJson(payload) {
  withNetworkDelay(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  });
}

function buildStatusMessage() {
  const state = !vehicle.online || isFailureActive()
    ? "offline"
    : vehicle.drive.command === "STOP"
    ? "idle"
    : "moving";

  return {
    type: "status",
    vehicleId: VEHICLE_ID,
    state,
    message:
      state === "offline"
        ? vehicle.failure.message || "Vehicle offline"
        : `drive=${vehicle.drive.command} throttle=${vehicle.drive.throttle} steering=${vehicle.drive.steering} light=${vehicle.lightOn ? "on" : "off"} camTilt=${Math.round(vehicle.cameraTilt)}`,
  };
}

function buildTelemetry() {
  const noisyWifi = vehicle.wifi + randomInt(-5, 5);
  return {
    type: "telemetry",
    vehicleId: VEHICLE_ID,
    online: vehicle.online && !isFailureActive(),
    battery: Math.round(vehicle.battery),
    wifi: clamp(noisyWifi, -90, -35),
    latency: randomLatencyMs(),
    cameraOn: vehicle.cameraOn,
    driveState: {
      command: vehicle.drive.command,
      throttle: vehicle.drive.throttle,
      steering: vehicle.drive.steering,
    },
    lightOn: vehicle.lightOn,
    cameraTilt: Math.round(vehicle.cameraTilt),
    behaviorProfile: vehicle.behaviorProfile,
    failure: isFailureActive()
      ? {
          type: vehicle.failure.type,
          message: vehicle.failure.message,
          untilTs: vehicle.failure.untilTs,
        }
      : null,
  };
}

function batteryDrainPerSecond() {
  const movement =
    Math.abs(vehicle.drive.throttle) * 0.06 +
    Math.abs(vehicle.drive.steering) * 0.025;
  const light = vehicle.lightOn ? 0.01 : 0;
  const camera = vehicle.cameraOn ? 0.008 : 0;
  const failure = isFailureActive() ? 0.02 : 0;
  return movement + light + camera + failure;
}

function updateBattery() {
  vehicle.battery = clamp(vehicle.battery - batteryDrainPerSecond(), 0, 100);

  if (vehicle.battery <= 3) {
    vehicle.online = false;
    vehicle.drive.command = "STOP";
    vehicle.drive.throttle = 0;
    vehicle.drive.steering = 0;
  } else if (vehicle.battery > 5) {
    vehicle.online = true;
  }
}

function activateRandomFailure() {
  if (isFailureActive()) return;
  if (Math.random() > SIM.failureTickChance) return;

  const chosen = failureCatalog[randomInt(0, failureCatalog.length - 1)];
  const duration = randomInt(
    SIM.failureDurationMinMs,
    SIM.failureDurationMaxMs
  );

  vehicle.failure.active = true;
  vehicle.failure.type = chosen.type;
  vehicle.failure.message = chosen.message;
  vehicle.failure.untilTs = Date.now() + duration;

  chosen.effect(vehicle);

  sendJson({
    type: "status",
    vehicleId: VEHICLE_ID,
    state: "offline",
    message: `${chosen.message} (simulated)`,
  });
}

function applyControl(data) {
  if (!vehicle.online || isFailureActive()) return;

  const command = CONTROL_COMMANDS.has(data.command) ? data.command : "STOP";
  const profile = vehicle.behaviorProfile || DEFAULT_PROFILE;
  const throttleScale = clamp(profile.driveScale, 0.3, 2);
  const steeringScale = clamp(profile.steeringScale, 0.3, 2);
  const throttleExponent = clamp(profile.throttleExponent, 0.5, 2.5);

  vehicle.drive.command = command;
  const rawThrottle = clamp(Number(data.payload?.throttle ?? 0), -1, 1);
  const rawSteering = clamp(Number(data.payload?.steering ?? 0), -1, 1);
  vehicle.drive.throttle = clamp(
    Math.sign(rawThrottle) * Math.pow(Math.abs(rawThrottle), throttleExponent) * throttleScale,
    -1,
    1
  );
  vehicle.drive.steering = clamp(rawSteering * steeringScale, -1, 1);
}

function applyAction(data) {
  if (!ACTION_COMMANDS.has(data.action)) return;

  const amount = clamp(Number(data.payload?.amount ?? 1), 0.25, 1);

  if (data.action === "LIGHT_TOGGLE") {
    vehicle.lightOn = !vehicle.lightOn;
    return;
  }

  if (data.action === "PROFILE_APPLY") {
    vehicle.behaviorProfile = normalizeProfile(data.payload?.profile);
    return;
  }

  if (data.action === "CAMERA_TOGGLE") {
    vehicle.cameraOn = !vehicle.cameraOn;
    return;
  }

  if (data.action === "CAM_RESET") {
    vehicle.cameraTilt = 45;
    return;
  }

  if (isFailureActive() && vehicle.failure.type === "camera_servo_stuck") {
    return;
  }

  if (data.action === "CAM_UP") {
    vehicle.cameraTilt = clamp(
      vehicle.cameraTilt + (vehicle.behaviorProfile?.cameraStepDeg || CAMERA_STEP_DEG) * amount,
      TILT_MIN,
      TILT_MAX
    );
  }

  if (data.action === "CAM_DOWN") {
    vehicle.cameraTilt = clamp(
      vehicle.cameraTilt - (vehicle.behaviorProfile?.cameraStepDeg || CAMERA_STEP_DEG) * amount,
      TILT_MIN,
      TILT_MAX
    );
  }
}

ws.on("open", () => {
  console.log(`Mock ESP connected to ${WS_URL}`);

  sendJson({
    type: "identify",
    clientType: "esp",
    vehicleId: VEHICLE_ID,
    timestamp: Date.now(),
    ...(MOCK_ESP_AUTH_TOKEN ? { authToken: MOCK_ESP_AUTH_TOKEN } : {}),
  });

  sendJson(buildStatusMessage());

  telemetryTimer = setInterval(() => {
    sendJson(buildTelemetry());
  }, SIM.telemetryEveryMs);

  statusTimer = setInterval(() => {
    sendJson(buildStatusMessage());
  }, SIM.statusEveryMs);

  batteryTimer = setInterval(() => {
    updateBattery();
  }, SIM.batteryEveryMs);

  failureTimer = setInterval(() => {
    activateRandomFailure();
  }, 2500);
});

ws.on("message", (raw) => {
  let data;

  try {
    data = JSON.parse(raw.toString());
  } catch (error) {
    console.error("Invalid message JSON:", error);
    return;
  }

  if (data.type === "control") {
    withNetworkDelay(() => {
      applyControl(data);
      sendJson({
        type: "status",
        vehicleId: VEHICLE_ID,
        state:
          !vehicle.online || isFailureActive()
            ? "offline"
            : vehicle.drive.command === "STOP"
            ? "idle"
            : "moving",
        message: `control applied: ${vehicle.drive.command}`,
      });
    });
  }

  if (data.type === "action") {
    withNetworkDelay(() => {
      applyAction(data);
      sendJson({
        type: "status",
        vehicleId: VEHICLE_ID,
        state:
          !vehicle.online || isFailureActive()
            ? "offline"
            : vehicle.drive.command === "STOP"
            ? "idle"
            : "moving",
        message: `action applied: ${data.action}`,
      });
      sendJson(buildTelemetry());
    });
  }

  console.log("ESP received:", JSON.stringify(data, null, 2));
});

ws.on("close", () => {
  console.log("Mock ESP disconnected");

  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }

  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }

  if (batteryTimer) {
    clearInterval(batteryTimer);
    batteryTimer = null;
  }

  if (failureTimer) {
    clearInterval(failureTimer);
    failureTimer = null;
  }
});

ws.on("error", (error) => {
  console.error("Mock ESP socket error:", error.message);
});

process.on("SIGINT", () => {
  console.log("\nShutting down Mock ESP...");
  ws.close();
});
