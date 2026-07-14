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
import type { IncomingMessage } from "@/types/socket";

type StatusState = "waiting" | "offline" | "moving" | "idle" | "error";
export interface DeviceLogEntry {
  id: number;
  ts: number;
  source: "esp32" | "esp32-cam" | string;
  level: "info" | "warn" | "error" | string;
  message: string;
}

const CAMERA_ORIENTATION_STORAGE_KEY = "controller.camera-orientation.v1";
const CAMERA_PAN_CENTER = 95;
const CAMERA_TILT_CENTER = 64;
const MAX_DEVICE_LOGS = 120;

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

function readPersistedCameraOrientation(): CameraOrientation {
  if (typeof window === "undefined") {
    return { pan: CAMERA_PAN_CENTER, tilt: CAMERA_TILT_CENTER };
  }

  try {
    const raw = window.localStorage.getItem(CAMERA_ORIENTATION_STORAGE_KEY);
    if (!raw) return { pan: CAMERA_PAN_CENTER, tilt: CAMERA_TILT_CENTER };
    const parsed = JSON.parse(raw) as Partial<CameraOrientation>;

    return {
      pan: typeof parsed.pan === "number" ? parsed.pan : CAMERA_PAN_CENTER,
      tilt: typeof parsed.tilt === "number" ? parsed.tilt : CAMERA_TILT_CENTER,
    };
  } catch {
    return { pan: CAMERA_PAN_CENTER, tilt: CAMERA_TILT_CENTER };
  }
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
  const [deviceLogs, setDeviceLogs] = useState<DeviceLogEntry[]>([]);
  const lastSentKeyRef = useRef<string>("");
  const hasRestoredCameraOrientationRef = useRef(false);
  const pendingToggleActionsRef = useRef<Set<string>>(new Set());
  const pendingToggleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSocketMessage = useCallback((message: IncomingMessage) => {
    if (message.type === "telemetry") {
      const reportedCameraPan =
        typeof message.cameraPan === "number" ? message.cameraPan : undefined;
      const reportedCameraTilt = message.cameraTilt;

      setCameraOrientation((prev) => ({
        pan: reportedCameraPan ?? prev.pan,
        tilt: reportedCameraTilt,
      }));

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
      setCameraFrameSrc(`data:image/${message.format || "jpeg"};base64,${message.data}`);
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
  }, []);

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
  });

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

  const handleEmergencyStop = useCallback(() => {
    handleMove("STOP", CONTROL_SOURCE.system, { throttle: 0, steering: 0 });
  }, [handleMove]);

  useEffect(() => {
    if (hasRestoredCameraOrientationRef.current) return;
    hasRestoredCameraOrientationRef.current = true;

    const restored = readPersistedCameraOrientation();
    // Run after hydration to keep initial server/client markup identical.
    const timer = window.setTimeout(() => {
      setCameraOrientation(restored);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CAMERA_ORIENTATION_STORAGE_KEY,
        JSON.stringify(cameraOrientation)
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [cameraOrientation]);

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
    };
  }, []);

  return {
    telemetry,
    deviceLogs,
    lastCommand,
    lastAction,
    lastActionAt,
    cameraOrientation,
    cameraFrameSrc,
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
    handleEmergencyStop,
  };
}
