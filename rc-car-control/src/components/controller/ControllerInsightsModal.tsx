"use client";

import { useEffect, useMemo, useState } from "react";
import type { DeviceLogEntry } from "@/hooks/useVehicleController";
import type { VehicleTelemetry } from "@/types/control";

export interface ControllerHistoryEntry {
  id: number;
  ts: number;
  kind: "move" | "action" | "system";
  value: string;
}

export interface ControllerTuningSettings {
  touchSteeringGain: number;
  touchThrottleGain: number;
  touchDeadzone: number;
  cameraActionGain: number;
}

export interface ControllerWatchdogSettings {
  enabled: boolean;
  timeoutMs: number;
}

export interface ControllerAlertRules {
  enabled: boolean;
  batteryBelow: number;
  latencyAbove: number;
  wifiBelow: number;
}

interface ControllerInsightsModalProps {
  open: boolean;
  onClose: () => void;
  telemetry: VehicleTelemetry;
  connectionState: string;
  latency: number | null;
  lastError?: string;
  history: ControllerHistoryEntry[];
  lastCommand: string;
  lastAction: string;
  latencySamples: number[];
  batterySamples: number[];
  wifiSamples: number[];
  deviceLogs: DeviceLogEntry[];
}

type TabKey = "telemetry" | "history" | "logs";
type LogFilter = "all" | "esp32" | "esp32-cam";

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sparklinePath(values: number[], width: number, height: number) {
  if (!values.length) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = values.length <= 1 ? 0 : width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = index * step;
      const normalized = (value - min) / span;
      const y = height - normalized * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function ControllerInsightsModal({
  open,
  onClose,
  telemetry,
  connectionState,
  latency,
  lastError,
  history,
  lastCommand,
  lastAction,
  latencySamples,
  batterySamples,
  wifiSamples,
  deviceLogs,
}: ControllerInsightsModalProps) {
  const [tab, setTab] = useState<TabKey>("telemetry");
  const [logFilter, setLogFilter] = useState<LogFilter>("all");

  const exportHistoryAsJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      count: history.length,
      history,
    };
    downloadTextFile(
      `controller-history-${Date.now()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  const exportHistoryAsCsv = () => {
    const header = "id,timestamp,kind,value";
    const rows = history.map((entry) => {
      const safeValue = entry.value.replaceAll('"', '""');
      return `${entry.id},${new Date(entry.ts).toISOString()},${entry.kind},"${safeValue}"`;
    });
    const csv = [header, ...rows].join("\n");
    downloadTextFile(`controller-history-${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
  };

  const filteredLogs = useMemo(() => {
    if (logFilter === "all") return deviceLogs;
    return deviceLogs.filter((entry) => entry.source === logFilter);
  }, [deviceLogs, logFilter]);

  const exportLogsAsText = () => {
    const rows = filteredLogs
      .slice()
      .reverse()
      .map((entry) => {
        const time = new Date(entry.ts).toISOString();
        return `[${time}] [${entry.source}] [${entry.level.toUpperCase()}] ${entry.message}`;
      });
    downloadTextFile(`device-logs-${Date.now()}.txt`, rows.join("\n"), "text/plain;charset=utf-8");
  };

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const graphMeta = useMemo(
    () => [
      {
        key: "latency",
        title: "Latency Trend",
        unit: "ms",
        values: latencySamples,
        color: "text-emerald-600",
        stroke: "#10b981",
      },
      {
        key: "battery",
        title: "Battery Trend",
        unit: "%",
        values: batterySamples,
        color: "text-sky-600",
        stroke: "#0ea5e9",
      },
      {
        key: "wifi",
        title: "WiFi Trend",
        unit: "dBm",
        values: wifiSamples,
        color: "text-amber-600",
        stroke: "#f59e0b",
      },
    ],
    [latencySamples, batterySamples, wifiSamples]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        className="glass-modal relative flex h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl p-4 text-slate-900 sm:h-[min(44rem,calc(100dvh-2rem))] sm:rounded-3xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-2 sm:mb-5">
          <h2 className="text-base font-semibold sm:text-lg">Controller Insights</h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mb-4 flex shrink-0 gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setTab("telemetry")}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              tab === "telemetry"
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            Telemetry
          </button>
          <button
            onClick={() => setTab("history")}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              tab === "history"
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            Command History
          </button>
          <button
            onClick={() => setTab("logs")}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              tab === "logs"
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            Device Logs
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {tab === "telemetry" && (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl glass-chip p-3">
                  <p className="text-xs text-slate-400">Connection</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{connectionState}</p>
                </div>
                <div className="rounded-2xl glass-chip p-3">
                  <p className="text-xs text-slate-400">Latency</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{latency ?? "-"} ms</p>
                </div>
                <div className="rounded-2xl glass-chip p-3">
                  <p className="text-xs text-slate-400">Battery</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{telemetry.battery}%</p>
                </div>
                <div className="rounded-2xl glass-chip p-3">
                  <p className="text-xs text-slate-400">WiFi</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{telemetry.wifi} dBm</p>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {graphMeta.map((item) => {
                  const current = item.values[item.values.length - 1];
                  const d = sparklinePath(item.values.slice(-24), 180, 54);
                  return (
                    <div key={item.key} className="rounded-2xl glass-chip p-3">
                      <p className="text-xs text-slate-400">{item.title}</p>
                      <p className={`mt-1 text-sm font-semibold ${item.color}`}>
                        {current ?? "-"} {item.unit}
                      </p>
                      <svg
                        viewBox="0 0 180 54"
                        className="mt-2 h-14 w-full rounded-lg bg-white/35"
                        role="img"
                        aria-label={item.title}
                      >
                        {d ? (
                          <path
                            d={d}
                            fill="none"
                            stroke={item.stroke}
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        ) : null}
                      </svg>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl glass-chip p-3 text-sm text-slate-600">
                Last Error: {lastError || "None"}
              </div>
            </>
          )}

          {tab === "history" && (
            <>
              <div className="rounded-2xl glass-chip p-3 text-sm text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    Last Move: <span className="font-semibold text-slate-900">{lastCommand}</span> · Last Action: <span className="font-semibold text-slate-900">{lastAction}</span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={exportHistoryAsJson}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Export JSON
                    </button>
                    <button
                      onClick={exportHistoryAsCsv}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl glass-chip p-2">
                <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                  {history.length === 0 ? (
                    <li className="rounded-xl px-2 py-2 text-sm text-slate-500">No command history yet</li>
                  ) : (
                    history.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between rounded-xl bg-white/45 px-2.5 py-2 text-sm"
                      >
                        <span className="font-medium text-slate-700">
                          [{entry.kind.toUpperCase()}] {entry.value}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(entry.ts).toLocaleTimeString()}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </>
          )}

          {tab === "logs" && (
            <>
              <div className="rounded-2xl glass-chip p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      ESP Log Monitor
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      ล่าสุด {filteredLogs.length} รายการ
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["all", "esp32", "esp32-cam"] as const).map((source) => (
                      <button
                        key={source}
                        onClick={() => setLogFilter(source)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                          logFilter === source
                            ? "bg-slate-900 text-white"
                            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {source === "all" ? "All" : source.toUpperCase()}
                      </button>
                    ))}
                    <button
                      onClick={exportLogsAsText}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Export TXT
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl glass-chip p-2">
                <ul className="max-h-[24rem] space-y-1 overflow-y-auto pr-1 font-mono text-xs">
                  {filteredLogs.length === 0 ? (
                    <li className="rounded-xl px-2 py-3 font-sans text-sm text-slate-500">
                      ยังไม่มี log จากบอร์ด
                    </li>
                  ) : (
                    filteredLogs.map((entry) => {
                      const levelClass =
                        entry.level === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-900"
                          : entry.level === "warn"
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : "border-slate-200 bg-white/55 text-slate-800";

                      return (
                        <li
                          key={entry.id}
                          className={`grid gap-1 rounded-xl border px-2.5 py-2 sm:grid-cols-[5.5rem_5.5rem_1fr] ${levelClass}`}
                        >
                          <span className="font-semibold">
                            {new Date(entry.ts).toLocaleTimeString()}
                          </span>
                          <span className="font-semibold uppercase">{entry.source}</span>
                          <span className="break-words">{entry.message}</span>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            </>
          )}

        </div>
      </section>
    </div>
  );
}
