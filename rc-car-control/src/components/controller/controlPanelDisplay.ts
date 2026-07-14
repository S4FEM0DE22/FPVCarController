export function pressedKeysLabel(command: string) {
  switch (command) {
    case "FORWARD":
      return "W";
    case "BACKWARD":
      return "S";
    case "LEFT":
      return "A";
    case "RIGHT":
      return "D";
    case "FORWARD_LEFT":
      return "W + A";
    case "FORWARD_RIGHT":
      return "W + D";
    case "BACKWARD_LEFT":
      return "S + A";
    case "BACKWARD_RIGHT":
      return "S + D";
    default:
      return "STOP";
  }
}

export function actionLabel(action: string) {
  switch (action) {
    case "CAM_UP":
      return "Arrow Up";
    case "CAM_DOWN":
      return "Arrow Down";
    case "CAM_LEFT":
      return "Arrow Left";
    case "CAM_RIGHT":
      return "Arrow Right";
    case "CAM_RESET":
      return "R / Cam Reset";
    case "CAMERA_TOGGLE":
      return "X / Cam Toggle";
    case "LIGHT_TOGGLE":
      return "L / Light";
    case "HORN":
      return "H / Horn";
    default:
      return action || "-";
  }
}

export function formatAngle(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}°`;
}

export const CAMERA_PAN_CENTER_DEG = 95;
export const CAMERA_TILT_CENTER_DEG = 64;

function formatAxisOffset(
  value: number,
  center: number,
  positiveLabel: string,
  negativeLabel: string
) {
  const offset = Math.round(value - center);

  if (offset === 0) return "Center";
  return `${offset > 0 ? positiveLabel : negativeLabel} ${Math.abs(offset)} deg`;
}

export function formatCameraAim(pan: number, tilt: number) {
  const panServoDeg = Math.round(pan);
  const tiltServoDeg = Math.round(tilt);
  const panOffsetDeg = Math.round(panServoDeg - CAMERA_PAN_CENTER_DEG);
  const tiltOffsetDeg = Math.round(tiltServoDeg - CAMERA_TILT_CENTER_DEG);
  const panDeg = Math.abs(panOffsetDeg);
  const tiltDeg = Math.abs(tiltOffsetDeg);
  const panLabel = formatAxisOffset(panServoDeg, CAMERA_PAN_CENTER_DEG, "Left", "Right");
  const tiltLabel = formatAxisOffset(tiltServoDeg, CAMERA_TILT_CENTER_DEG, "Up", "Down");

  return {
    panDeg,
    tiltDeg,
    panServoDeg,
    tiltServoDeg,
    panOffsetDeg,
    tiltOffsetDeg,
    panLabel,
    tiltLabel,
    summary: `Pan ${panDeg} deg (${panLabel}) / Tilt ${tiltDeg} deg (${tiltLabel})`,
    compact: `${panLabel} / ${tiltLabel}`,
  };
}

export function trackPowerFromCommand(command: string): { left: number; right: number } {
  switch (command) {
    case "FORWARD":
      return { left: 100, right: 100 };
    case "BACKWARD":
      return { left: -100, right: -100 };
    case "LEFT":
      return { left: -100, right: 100 };
    case "RIGHT":
      return { left: 100, right: -100 };
    case "FORWARD_LEFT":
      return { left: 40, right: 100 };
    case "FORWARD_RIGHT":
      return { left: 100, right: 40 };
    case "BACKWARD_LEFT":
      return { left: -40, right: -100 };
    case "BACKWARD_RIGHT":
      return { left: -100, right: -40 };
    default:
      return { left: 0, right: 0 };
  }
}

export function powerLabel(value: number) {
  if (value === 0) return "0% (Stop)";
  return `${value > 0 ? "+" : ""}${value}% (${value > 0 ? "Forward" : "Backward"})`;
}

export function driveStateLabel(left: number, right: number) {
  if (left === 0 && right === 0) return "Stop";
  if (left > 0 && right > 0 && left === right) return "Forward";
  if (left < 0 && right < 0 && left === right) return "Backward";
  if (left < 0 && right > 0) return "Pivot Left";
  if (left > 0 && right < 0) return "Pivot Right";
  if (left > 0 && right > 0 && left < right) return "Forward Left";
  if (left > 0 && right > 0 && left > right) return "Forward Right";
  if (left < 0 && right < 0 && left > right) return "Backward Left";
  if (left < 0 && right < 0 && left < right) return "Backward Right";
  return "Mixed";
}

export function latencyTone(latency: number | null | undefined, scheme: "light" | "dark" = "light") {
  if (scheme === "dark") {
    if (latency == null) return "text-slate-300";
    if (latency < 50) return "text-emerald-300";
    if (latency < 150) return "text-amber-300";
    return "text-rose-300";
  }

  if (latency == null) return "text-slate-500";
  if (latency < 50) return "text-emerald-700";
  if (latency < 150) return "text-amber-600";
  return "text-rose-600";
}
