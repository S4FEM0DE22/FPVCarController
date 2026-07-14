import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { buildActionMessage, buildControlMessage } from "@/lib/protocol";
import { getVehicleStateAfterMove } from "@/lib/vehicleStateMachine";
import type { ActionCommand, ControlCommand, VehicleTelemetry } from "@/types/control";
import type { ControlSource } from "@/lib/controlMapper";

const CAMERA_STEP = 6;
const PAN_CENTER = 95;
const PAN_MIN = 15;
const PAN_MAX = 175;
const TILT_CENTER = 64;
const TILT_MIN = 30;
const TILT_MAX = 110;

export interface CameraOrientation {
  pan: number;
  tilt: number;
}

interface CreateVehicleControllerOptions {
  setLastCommand: Dispatch<SetStateAction<ControlCommand>>;
  setLastAction: Dispatch<SetStateAction<ActionCommand | "-">>;
  setTelemetry: Dispatch<SetStateAction<VehicleTelemetry>>;
  setCameraOrientation: Dispatch<SetStateAction<CameraOrientation>>;
  lastSentKeyRef: MutableRefObject<string>;
  sendRaw: (payload: ReturnType<typeof buildControlMessage> | ReturnType<typeof buildActionMessage>) => boolean;
  pendingToggleActionsRef?: MutableRefObject<Set<string>>;
  pendingToggleTimeoutRef?: MutableRefObject<NodeJS.Timeout | null>;
}

function clampPan(value: number) {
  return Math.max(PAN_MIN, Math.min(PAN_MAX, value));
}

function clampTilt(value: number) {
  return Math.max(TILT_MIN, Math.min(TILT_MAX, value));
}

function commandToDrivePayload(command: ControlCommand) {
  switch (command) {
    case "FORWARD":
      return { throttle: 1, steering: 0 };
    case "BACKWARD":
      return { throttle: -1, steering: 0 };
    case "LEFT":
      return { throttle: 0, steering: -1 };
    case "RIGHT":
      return { throttle: 0, steering: 1 };
    case "FORWARD_LEFT":
      return { throttle: 1, steering: -1 };
    case "FORWARD_RIGHT":
      return { throttle: 1, steering: 1 };
    case "BACKWARD_LEFT":
      return { throttle: -1, steering: -1 };
    case "BACKWARD_RIGHT":
      return { throttle: -1, steering: 1 };
    default:
      return { throttle: 0, steering: 0 };
  }
}

export function handleMove(
  options: CreateVehicleControllerOptions,
  command: ControlCommand,
  source: ControlSource,
  payload?: Record<string, unknown>
) {
  const { setLastCommand, setTelemetry, lastSentKeyRef, sendRaw } = options;

  setLastCommand(command);

  setTelemetry((prev) => ({
    ...prev,
    vehicleState: getVehicleStateAfterMove(command, prev.online, prev.vehicleState),
  }));

  const finalPayload = payload ?? commandToDrivePayload(command);
  const payloadKey = JSON.stringify(finalPayload);
  const dedupeKey = `${command}:${source}:${payloadKey}`;

  if (dedupeKey === lastSentKeyRef.current) return;

  lastSentKeyRef.current = dedupeKey;
  sendRaw(buildControlMessage(command, source, finalPayload));
}

export function handleAction(
  options: CreateVehicleControllerOptions,
  action: ActionCommand,
  source: ControlSource,
  payload?: Record<string, unknown>
) {
  const { setLastAction, setTelemetry, setCameraOrientation, sendRaw, pendingToggleActionsRef, pendingToggleTimeoutRef } = options;

  setLastAction(action);

  const amount = typeof payload?.amount === "number" ? payload.amount : 1;
  const delta = CAMERA_STEP * Math.max(0.25, Math.min(1, amount));

  if (action === "CAM_LEFT") {
    setCameraOrientation((prev) => ({
      ...prev,
      pan: clampPan(prev.pan + delta),
    }));
  }

  if (action === "CAM_RIGHT") {
    setCameraOrientation((prev) => ({
      ...prev,
      pan: clampPan(prev.pan - delta),
    }));
  }

  if (action === "CAM_UP") {
    setCameraOrientation((prev) => ({
      ...prev,
      tilt: clampTilt(prev.tilt + delta),
    }));
  }

  if (action === "CAM_DOWN") {
    setCameraOrientation((prev) => ({
      ...prev,
      tilt: clampTilt(prev.tilt - delta),
    }));
  }

  if (action === "CAM_RESET") {
    setCameraOrientation({ pan: PAN_CENTER, tilt: TILT_CENTER });
  }

  if (action === "CAMERA_TOGGLE") {
    setTelemetry((prev) => ({
      ...prev,
      cameraOn: !prev.cameraOn,
    }));
    // Register pending toggle to prevent telemetry revert
    if (pendingToggleActionsRef) {
      pendingToggleActionsRef.current.add("CAMERA_TOGGLE");
      if (pendingToggleTimeoutRef?.current) {
        clearTimeout(pendingToggleTimeoutRef.current);
      }
      if (pendingToggleTimeoutRef) {
        pendingToggleTimeoutRef.current = setTimeout(() => {
          pendingToggleActionsRef.current.delete("CAMERA_TOGGLE");
        }, 1500);
      }
    }
  }

  if (action === "LIGHT_TOGGLE") {
    setTelemetry((prev) => ({
      ...prev,
      lightOn: !prev.lightOn,
    }));
    // Register pending toggle to prevent telemetry revert
    if (pendingToggleActionsRef) {
      pendingToggleActionsRef.current.add("LIGHT_TOGGLE");
      if (pendingToggleTimeoutRef?.current) {
        clearTimeout(pendingToggleTimeoutRef.current);
      }
      if (pendingToggleTimeoutRef) {
        pendingToggleTimeoutRef.current = setTimeout(() => {
          pendingToggleActionsRef.current.delete("LIGHT_TOGGLE");
        }, 1500);
      }
    }
  }

  sendRaw(buildActionMessage(action, source, payload));
}
