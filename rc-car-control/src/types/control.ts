export type InputMode = "keyboard" | "gamepad" | "touch";

export type ControlCommand =
  | "FORWARD"
  | "BACKWARD"
  | "LEFT"
  | "RIGHT"
  | "STOP"
  | "FORWARD_LEFT"
  | "FORWARD_RIGHT"
  | "BACKWARD_LEFT"
  | "BACKWARD_RIGHT";

export type ActionCommand =
  | "CAM_UP"
  | "CAM_DOWN"
  | "CAM_LEFT"
  | "CAM_RIGHT"
  | "CAM_RESET"
  | "CAMERA_TOGGLE"
  | "LIGHT_TOGGLE"
  | "HORN"
  | "PROFILE_APPLY"
  | "WIFI_SET"
  | "NETWORK_RECONNECT"
  | "REBOOT"
  | "WIFI_PORTAL_OPEN";

export interface VehicleSoftCodeProfile {
  name: string;
  driveScale: number;
  steeringScale: number;
  cameraStepDeg: number;
  throttleExponent: number;
  note: string;
}

export type VehicleState = "offline" | "idle" | "moving";

export interface VehicleDriveState {
  command: ControlCommand;
  throttle: number;
  steering: number;
}

export interface VehicleFailureState {
  type: string | null;
  message: string;
  untilTs: number;
}

export interface VehicleTelemetry {
  vehicleId: string;
  online: boolean;
  battery: number;
  wifi: number;
  latency: number;
  cameraOn: boolean;
  driveState: VehicleDriveState;
  lightOn: boolean;
  cameraPan: number;
  cameraTilt: number;
  cameraMode?: string;
  failure: VehicleFailureState | null;
  vehicleState: VehicleState;
  behaviorProfile?: VehicleSoftCodeProfile;
}
