import { clamp } from "@/lib/math";
import type { ControlCommand } from "@/types/control";

interface NormalizeDriveInputOptions {
  deadzone: number;
  throttleGain?: number;
  steeringGain?: number;
}

export interface NormalizedDriveInput {
  throttle: number;
  steering: number;
  command: ControlCommand;
}

const AXIS_SNAP = 0.03;
const OUTPUT_STEP = 0.01;

function quantize(value: number) {
  if (Math.abs(value) < AXIS_SNAP) return 0;
  return Number((Math.round(value / OUTPUT_STEP) * OUTPUT_STEP).toFixed(2));
}

export function resolveDriveCommand(
  throttle: number,
  steering: number
): ControlCommand {
  const forward = throttle > 0;
  const backward = throttle < 0;
  const left = steering < 0;
  const right = steering > 0;

  if (forward && left) return "FORWARD_LEFT";
  if (forward && right) return "FORWARD_RIGHT";
  if (backward && left) return "BACKWARD_LEFT";
  if (backward && right) return "BACKWARD_RIGHT";
  if (forward) return "FORWARD";
  if (backward) return "BACKWARD";
  if (left) return "LEFT";
  if (right) return "RIGHT";
  return "STOP";
}

export function normalizeDriveInput(
  rawThrottle: number,
  rawSteering: number,
  {
    deadzone,
    throttleGain = 1,
    steeringGain = 1,
  }: NormalizeDriveInputOptions
): NormalizedDriveInput {
  const safeThrottle = clamp(Number.isFinite(rawThrottle) ? rawThrottle : 0, -1, 1);
  const safeSteering = clamp(Number.isFinite(rawSteering) ? rawSteering : 0, -1, 1);
  const safeDeadzone = clamp(deadzone, 0, 0.8);
  const magnitude = Math.min(1, Math.hypot(safeThrottle, safeSteering));

  if (magnitude <= safeDeadzone || magnitude === 0) {
    return { throttle: 0, steering: 0, command: "STOP" };
  }

  const remappedMagnitude = (magnitude - safeDeadzone) / (1 - safeDeadzone);
  const radialScale = remappedMagnitude / magnitude;
  let throttle = safeThrottle * radialScale * throttleGain;
  let steering = safeSteering * radialScale * steeringGain;

  const gainedMagnitude = Math.hypot(throttle, steering);
  if (gainedMagnitude > 1) {
    throttle /= gainedMagnitude;
    steering /= gainedMagnitude;
  }

  throttle = quantize(clamp(throttle, -1, 1));
  steering = quantize(clamp(steering, -1, 1));

  return {
    throttle,
    steering,
    command: resolveDriveCommand(throttle, steering),
  };
}
