import type { VehicleSoftCodeProfile } from "@/types/control";

export const DEFAULT_SOFT_CODE_PROFILE: VehicleSoftCodeProfile = {
  name: "Balanced",
  driveScale: 1,
  steeringScale: 1,
  cameraStepDeg: 6,
  throttleExponent: 1,
  note: "Stable default mapping for general driving.",
};

export const SOFT_CODE_PRESETS: Record<string, VehicleSoftCodeProfile> = {
  gentle: {
    name: "Gentle",
    driveScale: 0.72,
    steeringScale: 0.85,
    cameraStepDeg: 4,
    throttleExponent: 1.35,
    note: "Softer throttle and smaller camera steps.",
  },
  balanced: DEFAULT_SOFT_CODE_PROFILE,
  sport: {
    name: "Sport",
    driveScale: 1.18,
    steeringScale: 1.12,
    cameraStepDeg: 8,
    throttleExponent: 0.9,
    note: "Sharper response for experienced driving.",
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function normalizeSoftCodeProfile(
  input: Partial<VehicleSoftCodeProfile> | null | undefined
): VehicleSoftCodeProfile {
  return {
    name: toString(input?.name, DEFAULT_SOFT_CODE_PROFILE.name),
    driveScale: clamp(toNumber(input?.driveScale, DEFAULT_SOFT_CODE_PROFILE.driveScale), 0.3, 2),
    steeringScale: clamp(toNumber(input?.steeringScale, DEFAULT_SOFT_CODE_PROFILE.steeringScale), 0.3, 2),
    cameraStepDeg: clamp(toNumber(input?.cameraStepDeg, DEFAULT_SOFT_CODE_PROFILE.cameraStepDeg), 1, 12),
    throttleExponent: clamp(toNumber(input?.throttleExponent, DEFAULT_SOFT_CODE_PROFILE.throttleExponent), 0.5, 2.5),
    note: toString(input?.note, DEFAULT_SOFT_CODE_PROFILE.note),
  };
}

