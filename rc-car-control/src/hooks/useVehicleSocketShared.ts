import type { OutgoingMessage } from "@/types/socket";

export type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR";

export interface UseVehicleSocketOptions {
  onMessage?: (message: import("@/types/socket").IncomingMessage) => void;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_JITTER_RATIO = 0.3;
const MAX_OUTBOUND_QUEUE_SIZE = 200;
const HEARTBEAT_PONG_TIMEOUT_MS = 15000;
const HEARTBEAT_PING_INTERVAL_MS = 5000;
const ACK_TIMEOUT_MS = 3000;
const ACK_MAX_RETRIES = 2;

function withJitter(delayMs: number) {
  const jitter = delayMs * RECONNECT_JITTER_RATIO;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs + offset));
}

function getReconnectDelayMs(attempt: number) {
  const expDelay = RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(RECONNECT_MAX_DELAY_MS, expDelay);
  return withJitter(capped);
}

function closeReasonMessage(event: CloseEvent) {
  const rawReason = event.reason?.trim();
  const reason = rawReason ? `, reason=${rawReason}` : "";
  return `close(code=${event.code}${reason})`;
}

export type AckTrackedMessage = Extract<OutgoingMessage, { type: "control" | "action" }>;

export interface PendingAckEntry {
  payload: AckTrackedMessage;
  retries: number;
  timeoutId: number | null;
}

function isAckTrackedMessage(payload: OutgoingMessage): payload is AckTrackedMessage {
  return (
    (payload.type === "control" || payload.type === "action") &&
    typeof payload.commandId === "string" &&
    payload.commandId.trim().length > 0
  );
}

export {
  ACK_MAX_RETRIES,
  ACK_TIMEOUT_MS,
  HEARTBEAT_PING_INTERVAL_MS,
  HEARTBEAT_PONG_TIMEOUT_MS,
  MAX_OUTBOUND_QUEUE_SIZE,
  closeReasonMessage,
  getReconnectDelayMs,
  isAckTrackedMessage,
};
