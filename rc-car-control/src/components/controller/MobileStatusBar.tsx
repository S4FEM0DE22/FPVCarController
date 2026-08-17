import { Activity, Info, Minimize2, Settings2 } from "lucide-react";

import { formatCameraAim } from "@/components/controller/controlPanelDisplay";
import type { InputMode } from "@/types/control";

interface MobileStatusBarProps {
  connectionState: string;
  vehicleOnline: boolean;
  battery: number;
  wifi: number;
  latency: number | null;
  cameraPan?: number;
  cameraTilt?: number;
  lastCommand?: string;
  lastAction?: string;
  actionPressed?: boolean;
  onSettings: () => void;
  onInfo?: () => void;
  onExitFullscreen?: () => void;
  desktop?: boolean;
  compact?: boolean;
  alertMessage?: string;
  alertLevel?: "warn" | "info";
  inputMode?: InputMode;
}

export default function MobileStatusBar({
  connectionState,
  vehicleOnline,
  battery,
  wifi,
  latency,
  cameraPan,
  cameraTilt,
  lastCommand,
  lastAction,
  actionPressed = false,
  onSettings,
  onInfo,
  onExitFullscreen,
  desktop = false,
  compact = false,
  alertMessage,
  alertLevel = "info",
  inputMode = "touch",
}: MobileStatusBarProps) {
  const cloudConnected = connectionState === "CONNECTED";
  const cloudConnecting = connectionState === "CONNECTING";
  const cameraAim =
    typeof cameraPan === "number" && typeof cameraTilt === "number"
      ? formatCameraAim(cameraPan, cameraTilt)
      : null;
  const showInput = lastCommand !== "STOP" || actionPressed;

  return (
    <div className={`status-bar pointer-events-auto rounded-lg border border-white/20 bg-slate-950/72 text-white shadow-lg backdrop-blur-md ${desktop ? "p-3" : compact ? "p-2" : "p-2.5"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cloudConnected ? "bg-emerald-400" : cloudConnecting ? "bg-amber-400" : "bg-rose-400"}`} />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-bold">
              Cloud {cloudConnected ? "เชื่อมแล้ว" : cloudConnecting ? "กำลังเชื่อม" : "หลุด"}
              <span className="mx-1 text-white/35">·</span>
              รถ {vehicleOnline ? "ออนไลน์" : "ออฟไลน์"}
            </p>
            <p className="text-[9px] font-medium uppercase text-white/45">{inputMode} control</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onInfo && (
            <button type="button" onClick={onInfo} className="grid h-8 w-8 place-items-center rounded-md border border-white/20 bg-white/10" title="ดู Insights" aria-label="ดู Insights">
              <Info size={15} />
            </button>
          )}
          <button type="button" onClick={onSettings} className="grid h-8 w-8 place-items-center rounded-md border border-white/20 bg-white/10" title="เปิดการตั้งค่า" aria-label="เปิดการตั้งค่า">
            <Settings2 size={15} />
          </button>
          {onExitFullscreen && (
            <button type="button" onClick={onExitFullscreen} className="grid h-8 w-8 place-items-center rounded-md border border-white/20 bg-white/10" title="ออกจากโหมดเต็มจอ" aria-label="ออกจากโหมดเต็มจอ">
              <Minimize2 size={15} />
            </button>
          )}
        </div>
      </div>

      <div className={`mt-2 grid gap-1.5 ${compact ? "grid-cols-2" : "grid-cols-4"}`}>
        <div className="rounded-md bg-white/10 px-2 py-1">
          <p className="text-[8px] uppercase text-white/45">Battery</p>
          <p className="text-[10px] font-bold">{vehicleOnline ? `${battery}%` : "—"}</p>
        </div>
        <div className="rounded-md bg-white/10 px-2 py-1">
          <p className="text-[8px] uppercase text-white/45">Vehicle Wi-Fi</p>
          <p className="text-[10px] font-bold">{vehicleOnline && wifi < 0 ? `${wifi} dBm` : "—"}</p>
        </div>
        <div className="rounded-md bg-white/10 px-2 py-1">
          <p className="text-[8px] uppercase text-white/45">Cloud Ping</p>
          <p className="text-[10px] font-bold">{cloudConnected && latency != null ? `${latency} ms` : "—"}</p>
        </div>
        <div className="rounded-md bg-white/10 px-2 py-1">
          <p className="text-[8px] uppercase text-white/45">Camera Aim</p>
          <p className="truncate text-[10px] font-bold">{cameraAim?.compact ?? "—"}</p>
        </div>
      </div>

      {alertMessage && (
        <div className={`mt-1.5 truncate rounded-md border px-2 py-1 text-[9px] font-semibold ${
          alertLevel === "warn"
            ? "border-amber-300/50 bg-amber-400/20 text-amber-50"
            : "border-sky-300/50 bg-sky-400/20 text-sky-50"
        }`}>
          {alertMessage}
        </div>
      )}

      {showInput && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-sky-300/30 bg-sky-400/15 px-2 py-1 text-[9px] font-semibold">
          <Activity size={12} />
          <span className="truncate">
            {lastCommand !== "STOP" ? `กำลังสั่ง ${lastCommand}` : `เพิ่งกด ${lastAction || "action"}`}
          </span>
        </div>
      )}
    </div>
  );
}
