"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NETWORK_CONFIG } from "@/constants/network";
import { createLogger } from "@/lib/logger";
import { buildIdentifyMessage, buildPingMessage } from "@/lib/protocol";
import type { IncomingMessage, OutgoingMessage } from "@/types/socket";
import {
  ACK_MAX_RETRIES,
  ACK_TIMEOUT_MS,
  HEARTBEAT_PING_INTERVAL_MS,
  HEARTBEAT_PONG_TIMEOUT_MS,
  MAX_OUTBOUND_QUEUE_SIZE,
  closeReasonMessage,
  getReconnectDelayMs,
  isAckTrackedMessage,
  type AckTrackedMessage,
  type ConnectionState,
  type PendingAckEntry,
  type UseVehicleSocketOptions,
} from "@/hooks/useVehicleSocketShared";
const socketLogger = createLogger("vehicle-socket");

export default function useVehicleSocket(
  options?: UseVehicleSocketOptions
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const onMessageRef = useRef(options?.onMessage);
  const reconnectAttemptRef = useRef(0);
  const outboundQueueRef = useRef<OutgoingMessage[]>([]);
  const pendingAckRef = useRef<Map<string, PendingAckEntry>>(new Map());
  const lastPongAtRef = useRef<number | null>(null);

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("DISCONNECTED");
  const [latency, setLatency] = useState<number | null>(null);
  const [lastError, setLastError] = useState("");
  const [outboundQueueSize, setOutboundQueueSize] = useState(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [pendingAckCount, setPendingAckCount] = useState(0);
  const [lastPongAgeMs, setLastPongAgeMs] = useState<number | null>(null);

  useEffect(() => {
    onMessageRef.current = options?.onMessage;
  }, [options?.onMessage]);

  const updateQueueSize = useCallback(() => {
    setOutboundQueueSize(outboundQueueRef.current.length);
  }, []);

  const updatePendingAckCount = useCallback(() => {
    setPendingAckCount(pendingAckRef.current.size);
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const clearPendingAckTimers = useCallback(() => {
    for (const pending of pendingAckRef.current.values()) {
      if (pending.timeoutId !== null) {
        window.clearTimeout(pending.timeoutId);
      }
    }
    pendingAckRef.current.clear();
    updatePendingAckCount();
  }, [updatePendingAckCount]);

  const startHeartbeatMonitor = useCallback(() => {
    lastPongAtRef.current = Date.now();
    setLastPongAgeMs(0);

    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
    }

    heartbeatTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const lastPongAt = lastPongAtRef.current;
      if (lastPongAt == null) return;

      const age = now - lastPongAt;
      setLastPongAgeMs(age);

      if (age > HEARTBEAT_PONG_TIMEOUT_MS) {
        const ws = wsRef.current;
        setLastError("Heartbeat timeout: pong not received within 15s");
        socketLogger.warn("heartbeat timeout", { ageMs: age });
        ws?.close(4000, "heartbeat timeout");
      }
    }, 1000);
  }, []);

  const scheduleAckTimeout = useCallback(
    (commandId: string) => {
      const pending = pendingAckRef.current.get(commandId);
      if (!pending) return;

      if (pending.timeoutId !== null) {
        window.clearTimeout(pending.timeoutId);
      }

      pending.timeoutId = window.setTimeout(() => {
        const latest = pendingAckRef.current.get(commandId);
        if (!latest) return;

        if (latest.retries >= ACK_MAX_RETRIES) {
          pendingAckRef.current.delete(commandId);
          updatePendingAckCount();
          setLastError(`Command ACK timeout: ${commandId}`);
          socketLogger.error("command ack timeout", {
            commandId,
            retries: latest.retries,
          });
          return;
        }

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          scheduleAckTimeout(commandId);
          return;
        }

        latest.retries += 1;

        try {
          ws.send(JSON.stringify(latest.payload));
          socketLogger.warn("command retry", {
            commandId,
            retry: latest.retries,
          });
        } catch {
          // Keep waiting for reconnect; timeout remains active.
        }

        scheduleAckTimeout(commandId);
      }, ACK_TIMEOUT_MS);
    },
    [updatePendingAckCount]
  );

  const trackPendingAck = useCallback(
    (payload: AckTrackedMessage) => {
      const commandId = payload.commandId;
      if (!pendingAckRef.current.has(commandId)) {
        pendingAckRef.current.set(commandId, {
          payload,
          retries: 0,
          timeoutId: null,
        });
        updatePendingAckCount();
      }

      scheduleAckTimeout(commandId);
    },
    [scheduleAckTimeout, updatePendingAckCount]
  );

  const resolveAck = useCallback(
    (commandId?: string) => {
      if (!commandId) return;

      const pending = pendingAckRef.current.get(commandId);
      if (!pending) return;

      if (pending.timeoutId !== null) {
        window.clearTimeout(pending.timeoutId);
      }

      pendingAckRef.current.delete(commandId);
      updatePendingAckCount();
    },
    [updatePendingAckCount]
  );

  const enqueueOutbound = useCallback((payload: OutgoingMessage) => {
    const queue = outboundQueueRef.current;

    if (queue.length >= MAX_OUTBOUND_QUEUE_SIZE) {
      queue.shift();
      socketLogger.warn("outbound queue full, dropping oldest message", {
        maxSize: MAX_OUTBOUND_QUEUE_SIZE,
      });
    }

    queue.push(payload);
    updateQueueSize();
  }, [updateQueueSize]);

  const sendOverSocket = useCallback(
    (ws: WebSocket, payload: OutgoingMessage) => {
      ws.send(JSON.stringify(payload));
      if (isAckTrackedMessage(payload)) {
        trackPendingAck(payload);
      }
    },
    [trackPendingAck]
  );

  const flushOutboundQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const queue = outboundQueueRef.current;
    while (queue.length > 0 && ws.readyState === WebSocket.OPEN) {
      const next = queue[0];
      try {
        sendOverSocket(ws, next);
        queue.shift();
        updateQueueSize();
      } catch {
        // Keep the unsent item in queue for the next reconnect.
        break;
      }
    }
  }, [sendOverSocket, updateQueueSize]);

  const resendPendingAckMessages = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    for (const pending of pendingAckRef.current.values()) {
      try {
        ws.send(JSON.stringify(pending.payload));
        if (typeof pending.payload.commandId === "string") {
          scheduleAckTimeout(pending.payload.commandId);
        }
      } catch {
        break;
      }
    }
  }, [scheduleAckTimeout]);

  const scheduleReconnect = useCallback(
    (reason: string, connectSocket: () => void) => {
      if (!shouldReconnectRef.current) return;

      reconnectAttemptRef.current += 1;
      const attempt = reconnectAttemptRef.current;
      setReconnectAttempts(attempt);
      const delayMs = getReconnectDelayMs(attempt);

      socketLogger.info("reconnect scheduled", {
        delayMs,
        attempt,
        reason,
      });

      reconnectTimerRef.current = window.setTimeout(() => {
        connectSocket();
      }, delayMs);
    },
    []
  );

  const sendRaw = useCallback((payload: OutgoingMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      enqueueOutbound(payload);
      return false;
    }

    try {
      sendOverSocket(ws, payload);
      return true;
    } catch {
      enqueueOutbound(payload);
      return false;
    }
  }, [enqueueOutbound, sendOverSocket]);

  const connect = useCallback(function connectSocket() {
    clearTimers();
    setConnectionState("CONNECTING");
    setLastError("");

    if (reconnectAttemptRef.current === 0) {
      socketLogger.debug("connecting");
    } else {
      socketLogger.debug("reconnect attempt", {
        attempt: reconnectAttemptRef.current,
      });
    }

    try {
      const ws = new WebSocket(NETWORK_CONFIG.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setReconnectAttempts(0);
        setConnectionState("CONNECTED");
        sendRaw(buildIdentifyMessage());
        flushOutboundQueue();
        resendPendingAckMessages();
        startHeartbeatMonitor();

        pingTimerRef.current = window.setInterval(() => {
          sendRaw(buildPingMessage());
        }, HEARTBEAT_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as IncomingMessage;

          if (data.type === "pong") {
            const now = Date.now();
            lastPongAtRef.current = now;
            setLastPongAgeMs(0);
            setLatency(now - data.timestamp);
          }

          if (data.type === "ack") {
            resolveAck(data.commandId);
          }

          if (data.type === "error" && typeof data.commandId === "string") {
            resolveAck(data.commandId);
          }

          onMessageRef.current?.(data);
        } catch {
          // ignore invalid json
        }
      };

      ws.onerror = () => {
        setConnectionState("ERROR");
        setLastError("WebSocket error");
        socketLogger.warn("socket error");
      };

      ws.onclose = (event) => {
        setConnectionState("DISCONNECTED");
        clearTimers();
        setLastPongAgeMs(null);

        const reason = closeReasonMessage(event);
        setLastError(`Disconnected: ${reason}`);
        scheduleReconnect(reason, connectSocket);
      };
    } catch {
      setConnectionState("ERROR");
      setLastError("Failed to connect");
      scheduleReconnect("connect exception", connectSocket);
    }
  }, [
    clearTimers,
    flushOutboundQueue,
    resendPendingAckMessages,
    resolveAck,
    scheduleReconnect,
    sendRaw,
    startHeartbeatMonitor,
  ]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearTimers();
      reconnectAttemptRef.current = 0;
      setReconnectAttempts(0);
      setLastPongAgeMs(null);
      clearPendingAckTimers();

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearPendingAckTimers, clearTimers]);

  return {
    connectionState,
    latency,
    lastError,
    outboundQueueSize,
    reconnectAttempts,
    pendingAckCount,
    lastPongAgeMs,
    sendRaw,
  };
}