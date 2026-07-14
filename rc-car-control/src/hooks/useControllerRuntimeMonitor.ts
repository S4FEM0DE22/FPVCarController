"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ControllerAlertRules,
  ControllerHistoryEntry,
  ControllerWatchdogSettings,
} from "@/components/controller/ControllerInsightsModal";
import type { ActionCommand, ControlCommand } from "@/types/control";

export interface RuntimeToast {
  id: number;
  level: "warn" | "info";
  message: string;
}

interface UseControllerRuntimeMonitorOptions {
  alertRules: ControllerAlertRules;
  watchdog: ControllerWatchdogSettings;
  connectionState: string;
  lastCommand: ControlCommand;
  lastAction: ActionCommand | "-";
  latency: number | null;
  battery: number;
  wifi: number;
  onEmergencyStop: () => void;
}

export default function useControllerRuntimeMonitor({
  alertRules,
  watchdog,
  connectionState,
  lastCommand,
  lastAction,
  latency,
  battery,
  wifi,
  onEmergencyStop,
}: UseControllerRuntimeMonitorOptions) {
  const [history, setHistory] = useState<ControllerHistoryEntry[]>([]);
  const [runtimeToasts, setRuntimeToasts] = useState<RuntimeToast[]>([]);
  const [latencySamples, setLatencySamples] = useState<number[]>([]);
  const [batterySamples, setBatterySamples] = useState<number[]>([]);
  const [wifiSamples, setWifiSamples] = useState<number[]>([]);

  const historyIdRef = useRef(1);
  const toastIdRef = useRef(1);
  const prevCommandRef = useRef(lastCommand);
  const prevActionRef = useRef(lastAction);
  const lastUserInputAtRef = useRef(0);
  const watchdogTriggeredRef = useRef(false);
  const alertFlagsRef = useRef({
    battery: false,
    latency: false,
    wifi: false,
  });
  const latencyRef = useRef<number | null>(latency);
  const batteryRef = useRef(battery);
  const wifiRef = useRef(wifi);

  useEffect(() => {
    if (lastUserInputAtRef.current === 0) {
      lastUserInputAtRef.current = Date.now();
    }
  }, []);

  useEffect(() => {
    latencyRef.current = latency;
    batteryRef.current = battery;
    wifiRef.current = wifi;
  }, [latency, battery, wifi]);

  useEffect(() => {
    if (prevCommandRef.current === lastCommand) return;
    prevCommandRef.current = lastCommand;
    setHistory((prev) => {
      const next = [
        {
          id: historyIdRef.current++,
          ts: Date.now(),
          kind: "move" as const,
          value: lastCommand,
        },
        ...prev,
      ];
      return next.slice(0, 60);
    });
  }, [lastCommand]);

  useEffect(() => {
    if (prevActionRef.current === lastAction) return;
    prevActionRef.current = lastAction;
    if (lastAction === "-") return;

    setHistory((prev) => {
      const next = [
        {
          id: historyIdRef.current++,
          ts: Date.now(),
          kind: "action" as const,
          value: lastAction,
        },
        ...prev,
      ];
      return next.slice(0, 60);
    });
  }, [lastAction]);

  const pushSystemEvent = useCallback((message: string) => {
    const now = Date.now();
    setHistory((prev) => {
      const next = [
        {
          id: historyIdRef.current++,
          ts: now,
          kind: "system" as const,
          value: message,
        },
        ...prev,
      ];
      return next.slice(0, 60);
    });
  }, []);

  const pushRuntimeToast = useCallback(
    (level: "warn" | "info", message: string) => {
      const toastId = toastIdRef.current++;
      setRuntimeToasts((prev) => [{ id: toastId, level, message }, ...prev].slice(0, 3));

      window.setTimeout(() => {
        setRuntimeToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, 3200);

      pushSystemEvent(message);
    },
    [pushSystemEvent]
  );

  useEffect(() => {
    const sampleTimer = window.setInterval(() => {
      const currentLatency = latencyRef.current;
      const currentBattery = batteryRef.current;
      const currentWifi = wifiRef.current;

      if (typeof currentLatency === "number") {
        setLatencySamples((prev) => [...prev.slice(-59), currentLatency]);
      }
      setBatterySamples((prev) => [...prev.slice(-59), currentBattery]);
      setWifiSamples((prev) => [...prev.slice(-59), currentWifi]);

      if (alertRules.enabled) {
        const batteryAlert = currentBattery <= alertRules.batteryBelow;
        const latencyAlert =
          typeof currentLatency === "number" && currentLatency >= alertRules.latencyAbove;
        const wifiAlert = currentWifi <= alertRules.wifiBelow;

        if (batteryAlert && !alertFlagsRef.current.battery) {
          pushRuntimeToast("warn", `Battery low: ${currentBattery}%`);
        }
        if (latencyAlert && !alertFlagsRef.current.latency) {
          pushRuntimeToast("warn", `Latency high: ${currentLatency} ms`);
        }
        if (wifiAlert && !alertFlagsRef.current.wifi) {
          pushRuntimeToast("warn", `WiFi weak: ${currentWifi} dBm`);
        }

        alertFlagsRef.current = {
          battery: batteryAlert,
          latency: Boolean(latencyAlert),
          wifi: wifiAlert,
        };
      }

      if (
        watchdog.enabled &&
        connectionState === "CONNECTED" &&
        lastCommand !== "STOP"
      ) {
        const idleMs = Date.now() - lastUserInputAtRef.current;
        if (idleMs >= watchdog.timeoutMs && !watchdogTriggeredRef.current) {
          watchdogTriggeredRef.current = true;
          onEmergencyStop();
          pushRuntimeToast("info", "Watchdog stop: no input detected");
        }
      }
    }, 1000);

    return () => {
      window.clearInterval(sampleTimer);
    };
  }, [
    alertRules,
    connectionState,
    lastCommand,
    onEmergencyStop,
    pushRuntimeToast,
    watchdog,
  ]);

  return {
    history,
    runtimeToasts,
    latencySamples,
    batterySamples,
    wifiSamples,
    markUserInput: () => {
      lastUserInputAtRef.current = Date.now();
      watchdogTriggeredRef.current = false;
    },
  };
}
