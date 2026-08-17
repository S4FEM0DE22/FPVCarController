import { useState } from "react";
import { Camera, Lightbulb, Octagon, RotateCcw, Volume2 } from "lucide-react";

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
    ? "h-11 min-w-16 px-3 text-xs"
    : compact
    ? "h-11 w-11 text-[8px]"
    : "h-10 min-w-12 px-2 text-[9px]";

  const toggleClass = (active: boolean, onTone: string) =>
    active
      ? `${onTone} text-white border-white/45 shadow-[0_6px_18px_rgba(15,23,42,0.22)]`
      : "border-white/20 bg-white/14 text-white/90";

  return (
    <div className={`action-bar pointer-events-auto flex items-center gap-1.5 rounded-lg border border-white/20 bg-slate-950/72 shadow-lg backdrop-blur-md ${compact ? "flex-col p-1.5" : "flex-wrap p-2"}`}>
      <button
        type="button"
        onClick={onLightToggle}
        className={`grid place-items-center rounded-md border font-semibold backdrop-blur-md transition active:scale-95 ${buttonSizeClass} ${toggleClass(lightOn, "bg-amber-500/65")}`}
        title="เปิดหรือปิดไฟ"
      >
        <Lightbulb size={16} />
        ไฟ {lightOn ? "เปิด" : "ปิด"}
      </button>

      <button
        type="button"
        onClick={onCameraReset}
        onPointerDown={() => setCameraResetPressed(true)}
        onPointerUp={() => setCameraResetPressed(false)}
        onPointerLeave={() => setCameraResetPressed(false)}
        onPointerCancel={() => setCameraResetPressed(false)}
        className={`grid place-items-center rounded-md border font-semibold text-white backdrop-blur-md transition ${buttonSizeClass} ${
          cameraResetActive
            ? "scale-95 border-sky-100/80 bg-sky-500/80"
            : "border-sky-200/60 bg-sky-500/40 active:scale-95"
        }`}
      >
        <RotateCcw size={16} />
        กลาง
      </button>

      <button
        type="button"
        onClick={onCameraToggle}
        className={`grid place-items-center rounded-md border font-semibold backdrop-blur-md transition active:scale-95 ${buttonSizeClass} ${toggleClass(cameraOn, "bg-emerald-500/65")}`}
        title="เปิดหรือปิดกล้อง"
      >
        <Camera size={16} />
        กล้อง {cameraOn ? "เปิด" : "ปิด"}
      </button>

      <button
        type="button"
        onClick={onHorn}
        onPointerDown={() => setHornPressed(true)}
        onPointerUp={() => setHornPressed(false)}
        onPointerLeave={() => setHornPressed(false)}
        onPointerCancel={() => setHornPressed(false)}
        className={`grid place-items-center rounded-md border font-semibold text-white backdrop-blur-md transition ${buttonSizeClass} ${
          hornActive
            ? "border-orange-100/80 bg-orange-500/80 scale-95"
            : "border-orange-200/60 bg-orange-500/35 active:scale-95"
        }`}
      >
        <Volume2 size={16} />
        แตร
      </button>

      <button
        type="button"
        onClick={onStop}
        className={`grid place-items-center rounded-md border border-rose-300 bg-rose-600 font-bold text-white shadow-md backdrop-blur-md transition active:scale-95 ${buttonSizeClass}`}
        title="หยุดรถทันที"
      >
        <Octagon size={17} />
        STOP
      </button>
    </div>
  );
}
