"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { CONTROL_SOURCE, type ControlSource } from "@/lib/controlMapper";
import {
  handleAction as handleVehicleAction,
  handleMove as handleVehicleMove,
  type CameraOrientation,
} from "@/lib/vehicleController";
import { getVehicleStateAfterStatus } from "@/lib/vehicleStateMachine";
import useVehicleSocket from "@/hooks/useVehicleSocket";
import { VEHICLE_CONFIG } from "@/constants/network";
import type {
  ActionCommand,
  ControlCommand,
  VehicleTelemetry,
} from "@/types/control";
import type {
  CameraStreamStatusMessage,
  IncomingMessage,
  WifiNetwork,
} from "@/types/socket";

type StatusState = "waiting" | "offline" | "moving" | "idle" | "error";
export type WifiScanState = "idle" | "scanning" | "ready" | "error";
export interface DeviceLogEntry {
  id: number;
  ts: number;
  source: "esp32" | "esp32-cam" | string;
  level: "info" | "warn" | "error" | string;
  message: string;
}

const CAMERA_PAN_CENTER = 95;
const CAMERA_TILT_CENTER = 64;
const MAX_DEVICE_LOGS = 120;
const WIFI_SCAN_TIMEOUT_MS = 20000;
const CAMERA_CONFIRM_TIMEOUT_MS = 1800;
const CAMERA_FRESHNESS_TIMEOUT_MS = 12000;
const CAMERA_POSITION_ACTIONS = new Set<ActionCommand>([
  "CAM_LEFT",
  "CAM_RIGHT",
  "CAM_UP",
  "CAM_DOWN",
  "CAM_RESET",
]);

const initialTelemetry: VehicleTelemetry = {
  vehicleId: VEHICLE_CONFIG.id,
  online: false,
  battery: 0,
  wifi: 0,
  latency: 0,
  cameraOn: false,
  driveState: {
    command: "STOP",
    throttle: 0,
    steering: 0,
  },
  lightOn: false,
  cameraPan: 95,
  cameraTilt: 64,
  failure: null,
  vehicleState: "offline",
};

function normalizeWifiNetworks(networks: WifiNetwork[]) {
  const strongestBySsid = new Map<string, WifiNetwork>();

  for (const network of networks) {
    const ssid = typeof network.ssid === "string" ? network.ssid.trim() : "";
    if (!ssid) continue;

    const normalized: WifiNetwork = {
      ssid,
      rssi: Number.isFinite(network.rssi) ? network.rssi : -100,
      channel: Number.isFinite(network.channel) ? network.channel : 0,
      secure: Boolean(network.secure),
    };
    const current = strongestBySsid.get(ssid);
    if (!current || normalized.rssi > current.rssi) {
      strongestBySsid.set(ssid, normalized);
    }
  }

  return [...strongestBySsid.values()].sort((a, b) => b.rssi - a.rssi);
}

export default function useVehicleController() {
  const [lastCommand, setLastCommand] = useState<ControlCommand>("STOP");
  const [lastAction, setLastAction] = useState<ActionCommand | "-">("-");
  const [lastActionAt, setLastActionAt] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Waiting for vehicle...");
  const [statusState, setStatusState] = useState<StatusState>("waiting");
  const [cameraOrientation, setCameraOrientation] =
    useState<CameraOrientation>({
      pan: CAMERA_PAN_CENTER,
      tilt: CAMERA_TILT_CENTER,
  });
  const [telemetry, setTelemetry] = useState<VehicleTelemetry>(initialTelemetry);
  const [cameraFrameSrc, setCameraFrameSrc] = useState("");
  const [cameraOnline, setCameraOnline] = useState(false);
  const [cameraStreamStatus, setCameraStreamStatus] =
    useState<CameraStreamStatusMessage | null>(null);
  const [deviceLogs, setDeviceLogs] = useState<DeviceLogEntry[]>([]);
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([]);
  const [wifiScanState, setWifiScanState] = useState<WifiScanState>("idle");
  const [wifiScanError, setWifiScanError] = useState("");
  const lastSentKeyRef = useRef<string>("");
  const pendingToggleActionsRef = useRef<Set<string>>(new Set());
  const pendingToggleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wifiScanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCameraUntilRef = useRef(0);
  const cameraFrameUrlRef = useRef("");
  const pendingCameraFrameRef = useRef<ArrayBuffer | null>(null);
  const cameraFrameDecodingRef = useRef(false);
  const cameraDecoderRef = useRef<HTMLImageElement | null>(null);
  const cameraDecoderUrlRef = useRef("");
  const cameraFrameDisposedRef = useRef(false);
  const cameraLastSeenAtRef = useRef(0);

  const replaceCameraFrame = useCallback((nextSrc: string) => {
    const previousSrc = cameraFrameUrlRef.current;
    cameraFrameUrlRef.current = nextSrc;
    setCameraFrameSrc(nextSrc);

    if (previousSrc.startsWith("blob:")) {
      window.setTimeout(() => URL.revokeObjectURL(previousSrc), 1000);
    }
  }, []);

  const decodeLatestCameraFrame = useCallback(function decodeLatestFrame() {
    if (cameraFrameDecodingRef.current || cameraFrameDisposedRef.current) return;

    const frame = pendingCameraFrameRef.current;
    if (!frame) return;

    pendingCameraFrameRef.current = null;
    cameraFrameDecodingRef.current = true;

    const nextUrl = URL.createObjectURL(new Blob([frame], { type: "image/jpeg" }));
    const decoder = new Image();
    decoder.decoding = "async";
    cameraDecoderRef.current = decoder;
    cameraDecoderUrlRef.current = nextUrl;

    const finish = (publish: boolean) => {
      decoder.onload = null;
      decoder.onerror = null;
      cameraDecoderRef.current = null;
      cameraDecoderUrlRef.current = "";

      if (publish && !cameraFrameDisposedRef.current) {
        replaceCameraFrame(nextUrl);
      } else {
        URL.revokeObjectURL(nextUrl);
      }

      cameraFrameDecodingRef.current = false;
      if (pendingCameraFrameRef.current && !cameraFrameDisposedRef.current) {
        window.queueMicrotask(decodeLatestFrame);
      }
    };

    decoder.onload = () => finish(true);
    decoder.onerror = () => finish(false);
    decoder.src = nextUrl;
  }, [replaceCameraFrame]);

  const handleBinaryCameraFrame = useCallback(
    (frame: ArrayBuffer) => {
      cameraLastSeenAtRef.current = Date.now();
      setCameraOnline(true);
      pendingCameraFrameRef.current = frame;
      decodeLatestCameraFrame();
    },
    [decodeLatestCameraFrame]
  );

  useEffect(() => {
    cameraFrameDisposedRef.current = false;

    return () => {
      cameraFrameDisposedRef.current = true;
      pendingCameraFrameRef.current = null;
      const decoder = cameraDecoderRef.current;
      if (decoder) {
        decoder.onload = null;
        decoder.onerror = null;
        decoder.src = "";
      }
      if (cameraDecoderUrlRef.current) {
        URL.revokeObjectURL(cameraDecoderUrlRef.current);
      }
      if (cameraFrameUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(cameraFrameUrlRef.current);
      }
    };
  }, []);

  const handleSocketMessage = useCallback((message: IncomingMessage) => {
    if (message.type === "telemetry") {
      const reportedCameraPan =
        typeof message.cameraPan === "number" ? message.cameraPan : undefined;
      const reportedCameraTilt = message.cameraTilt;

      setCameraOrientation((prev) => {
        const next = {
          pan: reportedCameraPan ?? prev.pan,
          tilt: reportedCameraTilt,
        };
        const telemetryMatchesTarget =
          Math.abs(next.pan - prev.pan) < 0.5 &&
          Math.abs(next.tilt - prev.tilt) < 0.5;

        if (
          Date.now() < pendingCameraUntilRef.current &&
          !telemetryMatchesTarget
        ) {
          return prev;
        }

        if (telemetryMatchesTarget) {
          pendingCameraUntilRef.current = 0;
        }
        return next;
      });

      setTelemetry((prev) => {
        const nextOnline = message.online;
        const nextDriveState = message.driveState;
        const nextVehicleState =
          nextOnline === false
            ? "offline"
            : nextDriveState.command === "STOP"
            ? "idle"
            : "moving";

        // Skip cameraOn/lightOn updates while pending toggle actions
        const hasPendingToggles = pendingToggleActionsRef.current.size > 0;
        const cameraOn = hasPendingToggles ? prev.cameraOn : message.cameraOn;
        const lightOn = hasPendingToggles ? prev.lightOn : message.lightOn;

        return {
          ...prev,
          vehicleId: message.vehicleId,
          online: nextOnline,
          battery: message.battery,
          wifi: message.wifi,
          wifiSsid: message.wifiSsid ?? prev.wifiSsid,
          wifiGateway: message.wifiGateway ?? prev.wifiGateway,
          latency: message.latency,
          cameraOn,
          driveState: nextDriveState,
          lightOn,
          cameraPan: reportedCameraPan ?? prev.cameraPan,
          cameraTilt: reportedCameraTilt,
          cameraMode: message.cameraMode ?? prev.cameraMode,
          failure: message.failure,
          vehicleState: nextVehicleState,
          behaviorProfile: message.behaviorProfile ?? prev.behaviorProfile,
        };
      });
    }

    if (message.type === "camera_frame") {
      cameraLastSeenAtRef.current = Date.now();
      setCameraOnline(true);
      replaceCameraFrame(`data:image/${message.format || "jpeg"};base64,${message.data}`);
    }

    if (message.type === "camera_status") {
      cameraLastSeenAtRef.current = message.online ? Date.now() : 0;
      setCameraOnline(message.online);
      if (!message.online) {
        replaceCameraFrame("");
        setCameraStreamStatus(null);
      }
    }

    if (message.type === "camera_stream_status") {
      cameraLastSeenAtRef.current = Date.now();
      setCameraOnline(true);
      setCameraStreamStatus(message);
    }

    if (message.type === "device_log") {
      setDeviceLogs((prev) => [
        {
          id: Date.now() + Math.random(),
          ts: message.timestamp || Date.now(),
          source: message.source,
          level: message.level,
          message: message.message,
        },
        ...prev,
      ].slice(0, MAX_DEVICE_LOGS));
    }

    if (message.type === "wifi_scan_result") {
      if (wifiScanTimeoutRef.current) {
        clearTimeout(wifiScanTimeoutRef.current);
        wifiScanTimeoutRef.current = null;
      }

      const networks = normalizeWifiNetworks(message.networks);
      setWifiNetworks(networks);
      setWifiScanError(message.error || "");
      setWifiScanState(message.error ? "error" : "ready");
    }

    if (message.type === "status") {
      if (message.state === "offline") {
        setStatusState("offline");
        setStatusMessage(message.message || "Vehicle disconnected");
      } else if (message.state === "moving") {
        setStatusState("moving");
        setStatusMessage("Vehicle is moving");
      } else if (message.state === "idle") {
        setStatusState("idle");
        setStatusMessage("Vehicle ready");
      }

      setTelemetry((prev) => ({
        ...prev,
        online: message.state === "offline" ? false : true,
        vehicleState: getVehicleStateAfterStatus(
          message.state,
          message.state === "offline" ? false : true,
          prev.vehicleState
        ),
      }));
    }

    if (message.type === "error" && message.message) {
      setStatusState("error");
      setStatusMessage(message.message);
    }
  }, [replaceCameraFrame]);

  const {
    connectionState,
    latency,
    lastError,
    outboundQueueSize,
    reconnectAttempts,
    pendingAckCount,
    lastPongAgeMs,
    sendRaw,
  } = useVehicleSocket({
    onMessage: handleSocketMessage,
    onCameraFrame: handleBinaryCameraFrame,
  });

  useEffect(() => {
    if (connectionState !== "CONNECTED") {
      cameraLastSeenAtRef.current = 0;
      setCameraOnline(false);
      setCameraStreamStatus(null);
      replaceCameraFrame("");
      return;
    }

    const timer = window.setInterval(() => {
      const lastSeenAt = cameraLastSeenAtRef.current;
      if (
        lastSeenAt > 0 &&
        Date.now() - lastSeenAt > CAMERA_FRESHNESS_TIMEOUT_MS
      ) {
        cameraLastSeenAtRef.current = 0;
        setCameraOnline(false);
        setCameraStreamStatus(null);
        replaceCameraFrame("");
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [connectionState, replaceCameraFrame]);

  const handleMove = useCallback(
    (
      command: ControlCommand,
      source: ControlSource,
      payload?: Record<string, unknown>
    ) => {
      handleVehicleMove(
        {
          setLastCommand,
          setLastAction,
          setTelemetry,
          setCameraOrientation,
          lastSentKeyRef,
          sendRaw,
        },
        command,
        source,
        payload
      );
    },
    [sendRaw]
  );

  const setLastActionWithTimestamp = useCallback(
    (nextAction: SetStateAction<ActionCommand | "-">) => {
      setLastAction(nextAction);
      setLastActionAt(Date.now());
    },
    []
  );

  const handleAction = useCallback(
    (
      action: ActionCommand,
      source: ControlSource,
      payload?: Record<string, unknown>
    ) => {
      if (CAMERA_POSITION_ACTIONS.has(action)) {
        pendingCameraUntilRef.current = Date.now() + CAMERA_CONFIRM_TIMEOUT_MS;
      }

      handleVehicleAction(
        {
          setLastCommand,
          setLastAction: setLastActionWithTimestamp,
          setTelemetry,
          setCameraOrientation,
          lastSentKeyRef,
          sendRaw,
          pendingToggleActionsRef,
          pendingToggleTimeoutRef,
        },
        action,
        source,
        payload
      );
    },
    [sendRaw, setLastActionWithTimestamp]
  );

  const handleSystemStop = useCallback(() => {
    // Safety-critical: always force-send STOP even if dedupe key currently equals STOP.
    lastSentKeyRef.current = "";
    handleMove("STOP", CONTROL_SOURCE.system, { throttle: 0, steering: 0 });
  }, [handleMove]);

  const handleKeyboardMove = useCallback(
    (command: ControlCommand, payload?: Record<string, unknown>) => {
      handleMove(command, CONTROL_SOURCE.keyboard, payload);
    },
    [handleMove]
  );

  const handleKeyboardAction = useCallback(
    (action: ActionCommand, payload?: Record<string, unknown>) => {
      handleAction(action, CONTROL_SOURCE.keyboard, payload);
    },
    [handleAction]
  );

  const handleGamepadMove = useCallback(
    (command: ControlCommand, payload?: Record<string, unknown>) => {
      handleMove(command, CONTROL_SOURCE.gamepad, payload);
    },
    [handleMove]
  );

  const handleGamepadAction = useCallback(
    (action: ActionCommand, payload?: Record<string, unknown>) => {
      handleAction(action, CONTROL_SOURCE.gamepad, payload);
    },
    [handleAction]
  );

  const handleTouchMove = useCallback(
    (command: ControlCommand, payload?: Record<string, unknown>) => {
      handleMove(command, CONTROL_SOURCE.touch, payload);
    },
    [handleMove]
  );

  const handleTouchAction = useCallback(
    (action: ActionCommand, payload?: Record<string, unknown>) => {
      handleAction(action, CONTROL_SOURCE.touch, payload);
    },
    [handleAction]
  );

  const handleSystemAction = useCallback(
    (action: ActionCommand, payload?: Record<string, unknown>) => {
      handleAction(action, CONTROL_SOURCE.system, payload);
    },
    [handleAction]
  );

  const requestWifiScan = useCallback(() => {
    if (wifiScanTimeoutRef.current) {
      clearTimeout(wifiScanTimeoutRef.current);
    }

    setWifiScanState("scanning");
    setWifiScanError("");
    handleAction("WIFI_SCAN", CONTROL_SOURCE.system);

    wifiScanTimeoutRef.current = setTimeout(() => {
      setWifiScanState("error");
      setWifiScanError("ESP32 ไม่ส่งผลการสแกนกลับมาภายในเวลาที่กำหนด");
      wifiScanTimeoutRef.current = null;
    }, WIFI_SCAN_TIMEOUT_MS);
  }, [handleAction]);

  const handleEmergencyStop = useCallback(() => {
    handleMove("STOP", CONTROL_SOURCE.system, { throttle: 0, steering: 0 });
  }, [handleMove]);

  useEffect(() => {
    const handlePageHide = () => {
      handleSystemStop();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleSystemStop();
      }
    };

    window.addEventListener("beforeunload", handleSystemStop);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("blur", handleSystemStop);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleSystemStop);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("blur", handleSystemStop);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [handleSystemStop]);

  const displayStatus = useMemo(() => {
    if (connectionState === "DISCONNECTED") {
      return { state: "offline", message: "Cloud disconnected" };
    }

    if (connectionState === "CONNECTING") {
      return { state: "connecting", message: "Connecting to cloud..." };
    }

    if (connectionState === "CONNECTED" && !telemetry.online) {
      return {
        state: "waiting",
        message: "Connected to cloud, waiting for vehicle...",
      };
    }

    if (statusState === "error") {
      return { state: "error", message: statusMessage };
    }

    if (telemetry.vehicleState === "moving") {
      return { state: "moving", message: "Vehicle is moving" };
    }

    if (telemetry.online) {
      return { state: "ready", message: "Vehicle connected and ready" };
    }

    return { state: statusState, message: statusMessage };
  }, [
    connectionState,
    telemetry.online,
    telemetry.vehicleState,
    statusMessage,
    statusState,
  ]);

  useEffect(() => {
    const pendingToggleTimeout = pendingToggleTimeoutRef.current;
    return () => {
      if (pendingToggleTimeout) {
        clearTimeout(pendingToggleTimeout);
      }
      if (wifiScanTimeoutRef.current) {
        clearTimeout(wifiScanTimeoutRef.current);
      }
    };
  }, []);

  return {
    telemetry,
    deviceLogs,
    wifiNetworks,
    wifiScanState,
    wifiScanError,
    lastCommand,
    lastAction,
    lastActionAt,
    cameraOrientation,
    cameraFrameSrc,
    cameraOnline,
    cameraStreamStatus,
    connectionState,
    latency,
    lastError,
    outboundQueueSize,
    reconnectAttempts,
    pendingAckCount,
    lastPongAgeMs,
    displayStatus,
    handleKeyboardMove,
    handleKeyboardAction,
    handleGamepadMove,
    handleGamepadAction,
    handleTouchMove,
    handleTouchAction,
    handleSystemAction,
    requestWifiScan,
    handleEmergencyStop,
  };
}
