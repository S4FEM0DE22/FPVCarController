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

const CAMERA_PAN_CENTER_DEG = 95;
const CAMERA_TILT_CENTER_DEG = 64;

function formatAxisOffset(
  value: number,
  center: number,
  positiveLabel: string,
  negativeLabel: string,
  centerLabel: string
) {
  const offset = Math.round(value - center);

  if (offset === 0) return `${centerLabel} 0°`;
  return `${offset > 0 ? positiveLabel : negativeLabel} ${Math.abs(offset)}°`;
}

export function formatCameraAim(pan: number, tilt: number) {
  const panServoDeg = Math.round(pan);
  const tiltServoDeg = Math.round(tilt);
  const panOffsetDeg = Math.round(panServoDeg - CAMERA_PAN_CENTER_DEG);
  const tiltOffsetDeg = Math.round(tiltServoDeg - CAMERA_TILT_CENTER_DEG);
  const panDeg = Math.abs(panOffsetDeg);
  const tiltDeg = Math.abs(tiltOffsetDeg);
  const panLabel = formatAxisOffset(
    panServoDeg,
    CAMERA_PAN_CENTER_DEG,
    "ซ้าย",
    "ขวา",
    "ตรง"
  );
  const tiltLabel = formatAxisOffset(
    tiltServoDeg,
    CAMERA_TILT_CENTER_DEG,
    "เงย",
    "ก้ม",
    "ระดับ"
  );

  return {
    panDeg,
    tiltDeg,
    panServoDeg,
    tiltServoDeg,
    panOffsetDeg,
    tiltOffsetDeg,
    panLabel,
    tiltLabel,
    summary: `มุมหัน ${panLabel} · มุมก้มเงย ${tiltLabel}`,
    compact: `หัน ${panLabel} · ${tiltLabel}`,
  };
}

export function trackPowerFromDrive(
  throttle: number,
  steering: number
): { left: number; right: number } {
  const safeThrottle = Math.max(-1, Math.min(1, throttle));
  const safeSteering = Math.max(-1, Math.min(1, steering));
  // Match the proportional differential mix used by both vehicle firmwares.
  // Steering changes the two tracks relative to the requested speed instead
  // of immediately saturating one track at 100%. Use speed magnitude for
  // reverse motion so the logical LEFT/RIGHT direction stays consistent.
  let left: number;
  let right: number;
  if (Math.abs(safeThrottle) <= 0.02) {
    left = safeSteering;
    right = -safeSteering;
  } else {
    const steeringMix = safeThrottle < 0 ? -safeSteering : safeSteering;
    const speedMagnitude = Math.abs(safeThrottle);
    left = safeThrottle + speedMagnitude * steeringMix;
    right = safeThrottle - speedMagnitude * steeringMix;
  }

  return {
    left: Math.round(Math.max(-1, Math.min(1, left)) * 100),
    right: Math.round(Math.max(-1, Math.min(1, right)) * 100),
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
