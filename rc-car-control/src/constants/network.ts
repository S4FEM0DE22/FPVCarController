const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL || "";

function normalizeBase(url: string) {
  return url.replace(/\/+$/, "");
}

function toHttp(url: string) {
  return url
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://");
}

const cloudBase = normalizeBase(CLOUD_URL);

const resolvedWsUrl =
  process.env.NEXT_PUBLIC_WS_URL ||
  (cloudBase
    ? `${cloudBase.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://")}/ws`
    : "ws://localhost:8080");

const resolvedVehicleId = process.env.NEXT_PUBLIC_VEHICLE_ID || "car-001";
const resolvedControllerAuthToken =
  process.env.NEXT_PUBLIC_CONTROLLER_AUTH_TOKEN || "";

export const CLIENT_TYPE = "web-controller";

const resolvedCamStreamUrl =
  process.env.NEXT_PUBLIC_ESP32_CAM_STREAM_URL ||
  (cloudBase ? `${normalizeBase(toHttp(cloudBase))}/stream` : "");

export const VEHICLE_CONFIG = {
  id: resolvedVehicleId,
} as const;

export const NETWORK_CONFIG = {
  cloudUrl: CLOUD_URL,
  wsUrl: resolvedWsUrl,
  camStreamUrl: resolvedCamStreamUrl,
  controllerAuthToken: resolvedControllerAuthToken,
} as const;

// Backward-compatible named exports.
export const VEHICLE_ID = VEHICLE_CONFIG.id;
