import type { ControlCommand, VehicleState } from "@/types/control";

const allowedTransitions: Record<VehicleState, ReadonlySet<VehicleState>> = {
  offline: new Set(["offline", "idle"]),
  idle: new Set(["offline", "idle", "moving"]),
  moving: new Set(["offline", "idle", "moving"]),
};

function getDesiredStateFromCommand(command: ControlCommand): VehicleState {
  return command === "STOP" ? "idle" : "moving";
}

function resolveStrictTransition(
  previous: VehicleState,
  desired: VehicleState,
  online: boolean
): VehicleState {
  if (!online) return "offline";

  if (allowedTransitions[previous].has(desired)) {
    return desired;
  }

  // Strict mode: never allow direct offline -> moving jump.
  if (previous === "offline" && desired === "moving") {
    return "idle";
  }

  return previous;
}

export function getVehicleStateAfterMove(
  command: ControlCommand,
  online: boolean,
  previous: VehicleState
): VehicleState {
  const desired = getDesiredStateFromCommand(command);
  return resolveStrictTransition(previous, desired, online);
}

export function getVehicleStateAfterStatus(
  status: VehicleState | undefined,
  online: boolean,
  previous: VehicleState
): VehicleState {
  if (!online || status === "offline") {
    return "offline";
  }

  if (status === "idle") {
    return resolveStrictTransition(previous, "idle", online);
  }

  if (status === "moving") {
    return resolveStrictTransition(previous, "moving", online);
  }

  return previous;
}
