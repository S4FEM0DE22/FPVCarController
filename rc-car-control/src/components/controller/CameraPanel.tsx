import { useState } from "react";
import {
  BookOpen,
  Camera,
  CameraOff,
  Lightbulb,
  Minimize2,
  Octagon,
  RotateCcw,
  Volume2,
  X,
} from "lucide-react";

import VideoStream from "@/components/controller/VideoStream";
import { useCameraFrameAvailable } from "@/lib/cameraFrameStore";
import {
  driveStateLabel,
  formatCameraAim,
  trackPowerFromCommand,
} from "@/components/controller/controlPanelDisplay";

interface CameraPanelProps {
  isMobile: boolean;
  cameraEnabled?: boolean;
  streamUrl?: string;
  lastCommand?: string;
  lastAction?: string;
  actionPressed?: boolean;
  cameraPan?: number;
  cameraTilt?: number;
  fullscreen?: boolean;
  connectionState?: string;
  vehicleOnline?: boolean;
  battery?: number;
  wifi?: number;
  latency?: number | null;
  profileName?: string;
  fullscreenMode?: boolean;
  onToggleFullscreen?: () => void;
  onEmergencyStop?: () => void;
  lastError?: string;
  cameraOn?: boolean;
  lightOn?: boolean;
  onHorn?: () => void;
  onLightToggle?: () => void;
  onCameraReset?: () => void;
  onCameraToggle?: () => void;
  externalPressedQuickAction?: "horn" | "cameraReset" | null;
  inputModeLabel?: string;
  controlGuideItems?: Array<{
    label: string;
    value: string;
    hint: string;
  }>;
}

type StreamStatus = "camera-off" | "no-url" | "invalid-url" | "connecting" | "live" | "error";

function streamStatusMeta(status: StreamStatus) {
  switch (status) {
    case "camera-off":
      return { label: "กล้องปิด", detail: "เปิดกล้องเพื่อดูภาพ", tone: "border-slate-500/50 bg-slate-950/65 text-white" };
    case "live":
      return { label: "ภาพสด", detail: "กำลังรับภาพจาก ESP32-CAM", tone: "border-emerald-300/50 bg-emerald-500/85 text-white" };
    case "invalid-url":
      return { label: "URL ไม่ถูกต้อง", detail: "ตรวจที่อยู่สตรีมกล้องในการตั้งค่า", tone: "border-rose-300/60 bg-rose-500/85 text-white" };
    case "connecting":
      return { label: "กำลังต่อภาพ", detail: "กำลังรอภาพจาก ESP32-CAM", tone: "border-amber-300/60 bg-amber-500/85 text-slate-950" };
    case "error":
      return { label: "ภาพขาด", detail: "เปิดกล้องอยู่ แต่โหลดภาพไม่สำเร็จ", tone: "border-rose-300/60 bg-rose-500/85 text-white" };
    default:
      return { label: "ยังไม่มี URL", detail: "ตั้งค่า URL ของ ESP32-CAM ก่อน", tone: "border-slate-500/50 bg-slate-950/65 text-white" };
  }
}

export default function CameraPanel({
  isMobile,
  cameraEnabled = true,
  streamUrl = "",
  lastCommand = "STOP",
  cameraPan = 95,
  cameraTilt = 64,
  connectionState = "DISCONNECTED",
  vehicleOnline = false,
  battery,
  wifi,
  latency,
  fullscreenMode = false,
  onToggleFullscreen,
  onEmergencyStop,
  lastError,
  cameraOn = false,
  lightOn = false,
  onHorn,
  onLightToggle,
  onCameraReset,
  onCameraToggle,
  externalPressedQuickAction = null,
  inputModeLabel = "CONTROL",
  controlGuideItems = [],
}: CameraPanelProps) {
  const frameAvailable = useCameraFrameAvailable();
  const [statusByUrl, setStatusByUrl] = useState<Record<string, StreamStatus>>({});
  const [showGuide, setShowGuide] = useState(false);
  const [pressedQuickAction, setPressedQuickAction] = useState<"horn" | "cameraReset" | null>(null);
  const activeQuickAction = pressedQuickAction ?? externalPressedQuickAction;
  const isHttpStreamUrl = /^https?:\/\//i.test(streamUrl);
  const effectiveStreamUrl = cameraEnabled && isHttpStreamUrl ? streamUrl : "";
  const effectiveFrameAvailable = cameraEnabled && frameAvailable;
  const streamStatus: StreamStatus = !cameraEnabled
    ? "camera-off"
    : effectiveFrameAvailable
    ? "live"
    : !streamUrl
    ? "no-url"
    : !isHttpStreamUrl
    ? "invalid-url"
    : statusByUrl[streamUrl] ?? "connecting";
  const streamMeta = streamStatusMeta(streamStatus);
  const trackPower = trackPowerFromCommand(lastCommand);
  const driveLabel = driveStateLabel(trackPower.left, trackPower.right);
  const cameraAim = formatCameraAim(cameraPan, cameraTilt);
  const cloudConnected = connectionState === "CONNECTED";

  const markStream = (status: StreamStatus) => {
    if (!streamUrl) return;
    setStatusByUrl((current) => ({ ...current, [streamUrl]: status }));
  };

  return (
    <section
      className={`relative min-h-0 w-full overflow-hidden bg-black ${
        fullscreenMode
          ? "h-full border-0 rounded-none shadow-none"
          : isMobile
          ? "mobile-embedded-camera rounded-lg border border-slate-700 shadow-sm"
          : "aspect-video min-h-[16rem] rounded-lg border border-slate-700 shadow-sm"
      }`}
      aria-label="ภาพจากกล้องและคำสั่งด่วน"
    >
      {(effectiveFrameAvailable || effectiveStreamUrl) && (
        <VideoStream
          streamUrl={effectiveStreamUrl}
          cameraOn={cameraEnabled}
          className="absolute inset-0 h-full w-full object-cover"
          onStreamLoad={() => markStream("live")}
          onStreamError={() => markStream("error")}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.52),transparent_24%,transparent_68%,rgba(2,6,23,0.72))]" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5 sm:p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${streamMeta.tone}`}>
            {streamMeta.label}
          </span>
          <span className="hidden text-[10px] font-semibold text-white/70 sm:inline">ESP32-CAM</span>
        </div>

        <div className="flex items-center gap-1.5">
          {fullscreenMode && controlGuideItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowGuide((current) => !current)}
              className={`pointer-events-auto grid h-9 w-9 place-items-center rounded-md border text-white backdrop-blur-md transition ${
                showGuide ? "border-sky-300 bg-sky-500/70" : "border-white/25 bg-black/40 hover:bg-black/55"
              }`}
              title={showGuide ? "ซ่อนคู่มือควบคุม" : "แสดงคู่มือควบคุม"}
              aria-label={showGuide ? "ซ่อนคู่มือควบคุม" : "แสดงคู่มือควบคุม"}
            >
              {showGuide ? <X size={17} /> : <BookOpen size={17} />}
            </button>
          )}
          {fullscreenMode && onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="pointer-events-auto flex h-9 items-center gap-2 rounded-md border border-white/25 bg-black/40 px-2.5 text-[10px] font-bold text-white backdrop-blur-md transition hover:bg-black/55"
              title="ออกจากโหมดเต็มจอ"
            >
              <Minimize2 size={16} />
              <span className="hidden sm:inline">ออกจากเต็มจอ</span>
            </button>
          )}
        </div>
      </div>

      {streamStatus !== "live" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-white">
          <div>
            {cameraEnabled ? <Camera className="mx-auto text-white/55" size={30} /> : <CameraOff className="mx-auto text-white/55" size={30} />}
            <p className="mt-2 text-sm font-bold">{streamMeta.label}</p>
            <p className="mt-1 text-xs text-white/60">{streamMeta.detail}</p>
          </div>
        </div>
      )}

      {fullscreenMode && showGuide && (
        <section className="absolute right-3 top-14 w-[min(19rem,calc(100%-1.5rem))] rounded-lg border border-white/20 bg-slate-950/78 p-3 text-white shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold">คู่มือควบคุม</h2>
            <span className="text-[9px] font-bold uppercase text-white/55">{inputModeLabel}</span>
          </div>
          <div className="mt-2 grid gap-1.5">
            {controlGuideItems.map((item) => (
              <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-white/10 pt-1.5 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold">{item.label}</p>
                  <p className="truncate text-[9px] text-white/50">{item.hint}</p>
                </div>
                <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-1 text-[9px] font-bold">{item.value}</kbd>
              </div>
            ))}
          </div>
        </section>
      )}

      {!fullscreenMode && !isMobile && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-slate-950/72 p-2.5 text-white backdrop-blur-md sm:p-3">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase text-white/55">คำสั่งด่วน</p>
            <p className="truncate text-[10px] text-white/75">ไฟ กล้อง และอุปกรณ์เสริม</p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onLightToggle && (
              <button
                type="button"
                onClick={onLightToggle}
                aria-pressed={lightOn}
                className={`flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-bold transition active:scale-95 ${
                  lightOn
                    ? "border-amber-200 bg-amber-400 text-slate-950"
                    : "border-white/20 bg-slate-950/70 text-white hover:bg-slate-900/85"
                }`}
                title="เปิดหรือปิดไฟรถ"
              >
                <Lightbulb size={16} />
                ไฟ {lightOn ? "เปิด" : "ปิด"}
              </button>
            )}
            {onCameraReset && (
              <button
                type="button"
                onClick={onCameraReset}
                onPointerDown={() => setPressedQuickAction("cameraReset")}
                onPointerUp={() => setPressedQuickAction(null)}
                onPointerLeave={() => setPressedQuickAction(null)}
                onPointerCancel={() => setPressedQuickAction(null)}
                className={`flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-bold text-white transition active:scale-95 ${
                  activeQuickAction === "cameraReset"
                    ? "border-sky-200 bg-sky-500"
                    : "border-white/20 bg-slate-950/70 hover:bg-slate-900/85"
                }`}
                title="ตั้งกล้องกลับมุมกึ่งกลาง"
              >
                <RotateCcw size={16} />
                กล้องกลาง
              </button>
            )}
            {onCameraToggle && (
              <button
                type="button"
                onClick={onCameraToggle}
                aria-pressed={cameraOn}
                className={`flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-bold transition active:scale-95 ${
                  cameraOn
                    ? "border-emerald-200 bg-emerald-500 text-white"
                    : "border-white/20 bg-slate-950/70 text-white hover:bg-slate-900/85"
                }`}
                title="เปิดหรือปิดกล้อง"
              >
                {cameraOn ? <Camera size={16} /> : <CameraOff size={16} />}
                กล้อง {cameraOn ? "เปิด" : "ปิด"}
              </button>
            )}
            {onHorn && (
              <button
                type="button"
                onClick={onHorn}
                onPointerDown={() => setPressedQuickAction("horn")}
                onPointerUp={() => setPressedQuickAction(null)}
                onPointerLeave={() => setPressedQuickAction(null)}
                onPointerCancel={() => setPressedQuickAction(null)}
                className={`flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-bold text-white transition active:scale-95 ${
                  activeQuickAction === "horn"
                    ? "border-orange-200 bg-orange-500"
                    : "border-white/20 bg-slate-950/70 hover:bg-slate-900/85"
                }`}
                title="แตร"
              >
                <Volume2 size={16} />
                แตร
              </button>
            )}
          </div>
        </div>
      )}

      {fullscreenMode && (
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5 sm:p-3">
          <div className="min-w-0 rounded-lg border border-white/20 bg-slate-950/70 px-3 py-2 text-white backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
              <span className={`font-bold ${cloudConnected ? "text-emerald-300" : "text-rose-300"}`}>
                Cloud {cloudConnected ? "เชื่อมแล้ว" : "หลุด"}
              </span>
              <span className={vehicleOnline ? "font-bold text-emerald-300" : "font-bold text-amber-300"}>
                รถ {vehicleOnline ? "ออนไลน์" : "ออฟไลน์"}
              </span>
              <span>แบต {vehicleOnline && typeof battery === "number" ? `${battery}%` : "—"}</span>
              <span>Wi-Fi {vehicleOnline && typeof wifi === "number" && wifi < 0 ? `${wifi} dBm` : "—"}</span>
              <span>Ping {cloudConnected && typeof latency === "number" ? `${latency} ms` : "—"}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/70">
              <span>คำสั่ง: <strong className="text-white">{driveLabel}</strong></span>
              <span>L {trackPower.left}% / R {trackPower.right}%</span>
              <span>กล้อง: {cameraAim.compact}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onLightToggle && (
              <button
                type="button"
                onClick={onLightToggle}
                className={`grid h-10 w-10 place-items-center rounded-md border text-white transition active:scale-95 ${
                  lightOn ? "border-amber-200 bg-amber-500" : "border-white/20 bg-slate-950/70"
                }`}
                title="เปิดหรือปิดไฟ"
                aria-label="เปิดหรือปิดไฟ"
              >
                <Lightbulb size={17} />
              </button>
            )}
            {onCameraReset && (
              <button
                type="button"
                onClick={onCameraReset}
                onPointerDown={() => setPressedQuickAction("cameraReset")}
                onPointerUp={() => setPressedQuickAction(null)}
                onPointerLeave={() => setPressedQuickAction(null)}
                onPointerCancel={() => setPressedQuickAction(null)}
                className={`grid h-10 w-10 place-items-center rounded-md border text-white transition active:scale-95 ${
                  activeQuickAction === "cameraReset" ? "border-sky-200 bg-sky-500" : "border-white/20 bg-slate-950/70"
                }`}
                title="ตั้งกล้องกลับกึ่งกลาง"
                aria-label="ตั้งกล้องกลับกึ่งกลาง"
              >
                <RotateCcw size={17} />
              </button>
            )}
            {onCameraToggle && (
              <button
                type="button"
                onClick={onCameraToggle}
                className={`grid h-10 w-10 place-items-center rounded-md border text-white transition active:scale-95 ${
                  cameraOn ? "border-emerald-200 bg-emerald-500" : "border-white/20 bg-slate-950/70"
                }`}
                title="เปิดหรือปิดกล้อง"
                aria-label="เปิดหรือปิดกล้อง"
              >
                <Camera size={17} />
              </button>
            )}
            {onHorn && (
              <button
                type="button"
                onClick={onHorn}
                onPointerDown={() => setPressedQuickAction("horn")}
                onPointerUp={() => setPressedQuickAction(null)}
                onPointerLeave={() => setPressedQuickAction(null)}
                onPointerCancel={() => setPressedQuickAction(null)}
                className={`grid h-10 w-10 place-items-center rounded-md border text-white transition active:scale-95 ${
                  activeQuickAction === "horn" ? "border-orange-200 bg-orange-500" : "border-white/20 bg-slate-950/70"
                }`}
                title="แตร"
                aria-label="แตร"
              >
                <Volume2 size={17} />
              </button>
            )}
            {onEmergencyStop && (
              <button
                type="button"
                onClick={onEmergencyStop}
                className="flex h-10 items-center gap-1.5 rounded-md border border-rose-300 bg-rose-600 px-3 text-[10px] font-bold text-white shadow-lg transition active:scale-95"
                title="หยุดรถทันที"
              >
                <Octagon size={17} /> STOP
              </button>
            )}
          </div>
        </div>
      )}

      {fullscreenMode && lastError && (
        <div className="absolute bottom-[4.75rem] left-3 max-w-[min(32rem,calc(100%-1.5rem))] rounded-md border border-rose-300/40 bg-rose-950/75 px-2.5 py-1.5 text-[10px] text-rose-100 backdrop-blur-md">
          {lastError}
        </div>
      )}
    </section>
  );
}
