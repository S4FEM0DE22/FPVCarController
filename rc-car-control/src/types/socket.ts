import type {
  ActionCommand,
  ControlCommand,
  VehicleDriveState,
  VehicleFailureState,
  VehicleSoftCodeProfile,
  VehicleState,
} from "@/types/control";

export interface ControlMessage {
  type: "control";
  commandId: string;
  vehicleId: string;
  source: "keyboard" | "gamepad" | "touch" | "system";
  command: ControlCommand;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface ActionMessage {
  type: "action";
  commandId: string;
  vehicleId: string;
  source: "keyboard" | "gamepad" | "touch" | "system";
  action: ActionCommand;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface IdentifyMessage {
  type: "identify";
  clientType: string;
  vehicleId: string;
  timestamp: number;
  authToken?: string;
}

export interface PingMessage {
  type: "ping";
  timestamp: number;
}

export interface TelemetryMessage {
  type: "telemetry";
  vehicleId: string;
  online: boolean;
  battery: number;
  wifi: number;
  wifiSsid?: string;
  wifiGateway?: string;
  latency: number;
  cameraOn: boolean;
  driveState: VehicleDriveState;
  lightOn: boolean;
  cameraPan?: number;
  cameraTilt: number;
  cameraMode?: string;
  failure: VehicleFailureState | null;
  behaviorProfile?: VehicleSoftCodeProfile;
}

export interface CameraFrameMessage {
  type: "camera_frame";
  vehicleId: string;
  format: "jpeg" | string;
  data: string;
  width?: number | null;
  height?: number | null;
  timestamp: number;
}

export interface CameraFrameMetaMessage {
  type: "camera_frame_meta";
  vehicleId: string;
  frameId: number;
  timestamp: number;
}

export interface CameraFrameRenderedMessage {
  type: "camera_frame_rendered";
  vehicleId: string;
  frameId: number;
  displayed: boolean;
  timestamp: number;
}

export interface CameraStatusMessage {
  type: "camera_status";
  vehicleId: string;
  online: boolean;
  message?: string;
  timestamp: number;
}

export type CameraStreamProfile = "realtime" | "balanced" | "quality";

export interface CameraStreamStatusMessage {
  type: "camera_stream_status";
  vehicleId: string;
  profile: CameraStreamProfile;
  mode: "idle" | "motion";
  fps: number;
  ackMs: number;
  frameBytes: number;
  jpegQuality: number;
  rssi: number;
  timeouts: number;
  wifiSsid?: string;
  wifiGateway?: string;
  timestamp: number;
}

export interface DeviceLogMessage {
  type: "device_log";
  vehicleId: string;
  source: "esp32" | "esp32-cam" | string;
  level: "info" | "warn" | "error" | string;
  message: string;
  timestamp: number;
}

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  channel: number;
  secure: boolean;
}

export interface WifiScanResultMessage {
  type: "wifi_scan_result";
  vehicleId: string;
  networks: WifiNetwork[];
  error?: string;
  timestamp: number;
  requestId?: string;
}

export interface StatusMessage {
  type: "status";
  vehicleId: string;
  state?: VehicleState;
  message?: string;
}

export interface AckMessage {
  type: "ack";
  commandId?: string;
  message?: string;
}

export interface PongMessage {
  type: "pong";
  timestamp: number;
}

export interface ErrorMessage {
  type: "error";
  commandId?: string;
  message?: string;
}

export type OutgoingMessage =
  | ControlMessage
  | ActionMessage
  | IdentifyMessage
  | PingMessage
  | CameraFrameRenderedMessage;

export type IncomingMessage =
  | TelemetryMessage
  | CameraFrameMessage
  | CameraFrameMetaMessage
  | CameraStatusMessage
  | CameraStreamStatusMessage
  | DeviceLogMessage
  | WifiScanResultMessage
  | StatusMessage
  | PongMessage
  | AckMessage
  | ErrorMessage;
