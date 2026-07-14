import {
  formatCameraAim,
  latencyTone,
} from "@/components/controller/controlPanelDisplay";
import type { InputMode } from "@/types/control";

interface MobileStatusBarProps {
  connectionState: string;
  battery: number;
  wifi: number;
  latency: number | null;
  cameraPan?: number;
  cameraTilt?: number;
  lastCommand?: string;
  lastAction?: string;
  lastActionAt?: number;
  actionPressed?: boolean;
  onSettings: () => void;
  onInfo?: () => void;
  desktop?: boolean;
  compact?: boolean;
  alertMessage?: string;
  alertLevel?: "warn" | "info";
  inputMode?: InputMode;
}

function connectionTone(connectionState: string) {
  if (connectionState.toLowerCase().includes("connected")) {
    return "bg-emerald-400";
  }
  return "bg-rose-400";
}

export default function MobileStatusBar({
  connectionState,
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
  desktop = false,
  compact = false,
  alertMessage,
  alertLevel = "info",
  inputMode = "touch",
}: MobileStatusBarProps) {
  const textSize = desktop ? "text-sm" : compact ? "text-[10px]" : "text-[11px]";
  const shellSpacing = desktop
    ? "gap-3 px-5 py-2.5"
    : compact
    ? "gap-1 px-2 py-1.5"
    : "gap-1.5 px-2.5 py-2";
  const pillSpacing = desktop ? "px-3 py-1" : "px-2 py-0.5 text-[10px]";
  const cameraAim =
    typeof cameraPan === "number" && typeof cameraTilt === "number"
      ? formatCameraAim(cameraPan, cameraTilt)
      : null;

  return (
    <div
      className={`status-bar pointer-events-auto flex flex-wrap items-center justify-between rounded-2xl border border-white/24 bg-white/14 text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur-2xl ${shellSpacing}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/18 font-semibold backdrop-blur-md ${pillSpacing}`}
        >
          <span className={`h-2 w-2 rounded-full ${connectionTone(connectionState)}`} />
          <span className={compact ? "max-w-20 truncate" : "max-w-28 truncate"}>
            {connectionState}
          </span>
        </span>
        <span
          className={`rounded-full border border-white/20 bg-slate-900/22 font-medium ${pillSpacing}`}
        >
          Ping{" "}
          <span className={`font-semibold ${latencyTone(latency, "dark")}`}>
            {latency ?? "-"} ms
          </span>
        </span>
        <span
          className={`rounded-full border border-white/20 bg-slate-900/22 font-semibold uppercase ${pillSpacing}`}
        >
          {inputMode}
        </span>
      </div>

      <div className={`flex items-center gap-1.5 ${textSize}`}>
        <span className="whitespace-nowrap rounded-full border border-white/20 bg-black/15 px-2 py-0.5">
          Bat <span className="font-semibold">{battery}%</span>
        </span>
        <span className="whitespace-nowrap rounded-full border border-white/20 bg-black/15 px-2 py-0.5">
          Sig <span className="font-semibold">{wifi}</span>
        </span>
        {cameraAim && (
          <span className="whitespace-nowrap rounded-full border border-white/20 bg-black/15 px-2 py-0.5">
            Cam{" "}
            <span className="font-semibold">
              {cameraAim.panLabel} / {cameraAim.tiltLabel}
            </span>
            <span className="ml-1 text-white/60">
              {cameraAim.panDeg}/{cameraAim.tiltDeg}
            </span>
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSettings}
          className={`rounded-full border border-white/30 bg-white/18 font-semibold text-white transition active:scale-95 ${
            desktop ? "px-4 py-1 text-sm" : "px-2.5 py-1 text-[10px] sm:px-3"
          }`}
        >
          <span className="sm:hidden">Set</span>
          <span className="hidden sm:inline">Settings</span>
        </button>
        {onInfo && (
          <button
            type="button"
            onClick={onInfo}
            className={`rounded-full border border-white/30 bg-white/18 font-semibold text-white transition active:scale-95 ${
              desktop ? "px-4 py-1 text-sm" : "px-2.5 py-1 text-[10px]"
            }`}
          >
            Info
          </button>
        )}
      </div>

      {alertMessage && (
        <div
          className={`basis-full truncate rounded-xl border px-2 py-1 text-[10px] font-semibold ${
            alertLevel === "warn"
              ? "border-amber-300/50 bg-amber-400/20 text-amber-50"
              : "border-sky-300/50 bg-sky-400/20 text-sky-50"
          }`}
        >
          {alertMessage}
        </div>
      )}

      {(lastCommand || lastAction) && (
        <div className="basis-full truncate rounded-xl border border-white/18 bg-black/15 px-2 py-1 text-[10px] font-semibold text-white/90">
          Input {lastCommand && lastCommand !== "STOP" ? "Holding" : "Idle"}:{" "}
          {lastCommand || "STOP"} / Action{" "}
          {actionPressed ? "Pressed" : "Idle"}:{" "}
          {lastAction || "-"}
        </div>
      )}
    </div>
  );
}
