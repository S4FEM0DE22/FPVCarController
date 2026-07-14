import { CLIENT_TYPE, NETWORK_CONFIG, VEHICLE_ID } from "@/constants/network";
import type { ActionCommand, ControlCommand } from "@/types/control";
import type {
  ActionMessage,
  ControlMessage,
  IdentifyMessage,
  PingMessage,
} from "@/types/socket";

let commandSequence = 0;

function createCommandId(prefix: "ctl" | "act") {
  commandSequence = (commandSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${commandSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function buildIdentifyMessage(): IdentifyMessage {
  return {
    type: "identify",
    clientType: CLIENT_TYPE,
    vehicleId: VEHICLE_ID,
    timestamp: Date.now(),
    ...(NETWORK_CONFIG.controllerAuthToken
      ? { authToken: NETWORK_CONFIG.controllerAuthToken }
      : {}),
  };
}

export function buildControlMessage(
  command: ControlCommand,
  source: "keyboard" | "gamepad" | "touch" | "system",
  payload?: Record<string, unknown>
): ControlMessage {
  return {
    type: "control",
    commandId: createCommandId("ctl"),
    vehicleId: VEHICLE_ID,
    source,
    command,
    timestamp: Date.now(),
    ...(payload ? { payload } : {}),
  };
}

export function buildActionMessage(
  action: ActionCommand,
  source: "keyboard" | "gamepad" | "touch" | "system",
  payload?: Record<string, unknown>
): ActionMessage {
  return {
    type: "action",
    commandId: createCommandId("act"),
    vehicleId: VEHICLE_ID,
    source,
    action,
    timestamp: Date.now(),
    ...(payload ? { payload } : {}),
  };
}

export function buildPingMessage(): PingMessage {
  return {
    type: "ping",
    timestamp: Date.now(),
  };
}
