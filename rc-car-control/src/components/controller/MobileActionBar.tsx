import { useState } from "react";

interface MobileActionBarProps {
  cameraOn: boolean;
  lightOn: boolean;
  onCameraToggle: () => void;
  onCameraReset: () => void;
  onLightToggle: () => void;
  onHorn: () => void;
  onStop: () => void;
  desktop?: boolean;
  compact?: boolean;
  externalPressedQuickAction?: "horn" | "cameraReset" | null;
}

export default function MobileActionBar({
  cameraOn,
  lightOn,
  onCameraToggle,
  onCameraReset,
  onLightToggle,
  onHorn,
  onStop,
  desktop = false,
  compact = false,
  externalPressedQuickAction = null,
}: MobileActionBarProps) {
  const [hornPressed, setHornPressed] = useState(false);
  const [cameraResetPressed, setCameraResetPressed] = useState(false);
  const hornActive = hornPressed || externalPressedQuickAction === "horn";
  const cameraResetActive =
    cameraResetPressed || externalPressedQuickAction === "cameraReset";
  const buttonSizeClass = desktop
    ? "px-4 py-2 text-sm"
    : compact
    ? "px-2.5 py-2 text-[10px]"
    : "px-3 py-1.5 text-[11px]";

  const toggleClass = (active: boolean, onTone: string) =>
    active
      ? `${onTone} text-white border-white/45 shadow-[0_6px_18px_rgba(15,23,42,0.22)]`
      : "border-white/20 bg-white/14 text-white/90";

  return (
    <div className={`action-bar pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/22 bg-white/14 shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur-2xl ${compact ? "flex-col px-2 py-2" : "flex-wrap"} ${desktop ? "px-3 py-3" : compact ? "" : "px-2 py-2"}`}>
      <button
        onClick={onCameraToggle}
        className={`rounded-xl border font-semibold backdrop-blur-md transition active:scale-95 ${buttonSizeClass} ${toggleClass(cameraOn, "bg-emerald-500/65")}`}
      >
        Cam {cameraOn ? "ON" : "OFF"}
      </button>

      <button
        onClick={onLightToggle}
        className={`rounded-xl border font-semibold backdrop-blur-md transition active:scale-95 ${buttonSizeClass} ${toggleClass(lightOn, "bg-amber-500/65")}`}
      >
        Light {lightOn ? "ON" : "OFF"}
      </button>

      <button
        onClick={onCameraReset}
        onPointerDown={() => setCameraResetPressed(true)}
        onPointerUp={() => setCameraResetPressed(false)}
        onPointerLeave={() => setCameraResetPressed(false)}
        onPointerCancel={() => setCameraResetPressed(false)}
        className={`rounded-xl border font-semibold text-white backdrop-blur-md transition ${buttonSizeClass} ${
          cameraResetActive
            ? "scale-95 border-sky-100/80 bg-sky-500/80"
            : "border-sky-200/60 bg-sky-500/40 active:scale-95"
        }`}
      >
        Reset
      </button>

      <button
        onClick={onHorn}
        onPointerDown={() => setHornPressed(true)}
        onPointerUp={() => setHornPressed(false)}
        onPointerLeave={() => setHornPressed(false)}
        onPointerCancel={() => setHornPressed(false)}
        className={`rounded-xl border font-semibold text-white backdrop-blur-md transition ${buttonSizeClass} ${
          hornActive
            ? "border-orange-100/80 bg-orange-500/80 scale-95"
            : "border-orange-200/60 bg-orange-500/35 active:scale-95"
        }`}
      >
        Horn
      </button>

      <button
        onClick={onStop}
        className={`rounded-xl border border-rose-200/70 bg-rose-500/45 font-bold text-white shadow-[0_8px_24px_rgba(244,63,94,0.25)] backdrop-blur-md transition active:scale-95 ${buttonSizeClass}`}
      >
        STOP
      </button>
    </div>
  );
}
