import { useState } from "react";
import ControlPanelBase, {
  ControlPanelInfoCard,
} from "@/components/controller/ControlPanelBase";
import VideoStream from "@/components/controller/VideoStream";
import {
  actionLabel,
  driveStateLabel,
  formatCameraAim,
  latencyTone,
  powerLabel,
  pressedKeysLabel,
  trackPowerFromCommand,
} from "@/components/controller/controlPanelDisplay";

interface CameraPanelProps {
  isMobile: boolean;
  cameraEnabled?: boolean;
  streamUrl?: string;
  frameSrc?: string;
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

type StreamStatus =
  | "camera-off"
  | "no-url"
  | "invalid-url"
  | "connecting"
  | "live"
  | "error";

function streamStatusMeta(status: StreamStatus) {
  switch (status) {
    case "camera-off":
      return {
        label: "CAM OFF",
        className: "border-slate-300 bg-slate-100 text-slate-600",
      };
    case "live":
      return {
        label: "LIVE",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "invalid-url":
      return {
        label: "INVALID URL",
        className: "border-rose-200 bg-rose-50 text-rose-600",
      };
    case "connecting":
      return {
        label: "CONNECTING",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    case "error":
      return {
        label: "ERROR",
        className: "border-rose-200 bg-rose-50 text-rose-600",
      };
    default:
      return {
        label: "NO URL",
        className: "border-slate-200 bg-slate-100 text-slate-600",
      };
  }
}

export default function CameraPanel({
  isMobile,
  cameraEnabled = true,
  streamUrl = "",
  frameSrc = "",
  lastCommand,
  lastAction,
  cameraPan,
  cameraTilt,
  fullscreen = false,
  connectionState,
  vehicleOnline,
  battery,
  wifi,
  latency,
  profileName,
  fullscreenMode = true,
  onToggleFullscreen,
  onEmergencyStop,
  lastError,
  cameraOn,
  lightOn,
  onHorn,
  onLightToggle,
  onCameraReset,
  onCameraToggle,
  externalPressedQuickAction = null,
  inputModeLabel = "CONTROL",
  controlGuideItems = [],
}: CameraPanelProps) {
  const [statusByUrl, setStatusByUrl] = useState<Record<string, StreamStatus>>({});
  const [pressedQuickAction, setPressedQuickAction] = useState<
    "horn" | "cameraReset" | null
  >(null);
  const activeQuickAction = pressedQuickAction ?? externalPressedQuickAction;

  const hasControlInfo =
    lastCommand !== undefined &&
    lastAction !== undefined &&
    cameraPan !== undefined &&
    cameraTilt !== undefined;

  const trackPower = hasControlInfo
    ? trackPowerFromCommand(lastCommand)
    : { left: 0, right: 0 };
  const turnRatio = Math.abs(trackPower.left - trackPower.right);
  const isHttpStreamUrl = /^https?:\/\//i.test(streamUrl);
  const effectiveStreamUrl = cameraEnabled && isHttpStreamUrl ? streamUrl : "";
  const effectiveFrameSrc = cameraEnabled && frameSrc ? frameSrc : "";
  const streamStatus: StreamStatus = !cameraEnabled
    ? "camera-off"
    : effectiveFrameSrc
    ? "live"
    : !streamUrl
    ? "no-url"
    : !isHttpStreamUrl
    ? "invalid-url"
    : statusByUrl[streamUrl] ?? "connecting";
  const streamMeta = streamStatusMeta(streamStatus);
  const displayPan = hasControlInfo ? Math.round(cameraPan) : 95;
  const displayTilt = hasControlInfo ? Math.round(cameraTilt) : 0;
  const cameraAim = formatCameraAim(displayPan, displayTilt);
  const driveHeld = lastCommand !== undefined && lastCommand !== "STOP";

  if (fullscreen) {
    return (
      <section className="relative flex min-h-0 w-full overflow-hidden rounded-[2rem] border border-white/70 bg-slate-950 shadow-[0_28px_60px_rgba(15,23,42,0.22)]">
        <div className="relative aspect-[16/9] w-full min-h-0 overflow-hidden bg-slate-950">
          <VideoStream
            streamUrl={effectiveStreamUrl}
            frameSrc={effectiveFrameSrc}
            cameraOn={cameraEnabled}
            className="absolute inset-0 h-full w-full object-cover"
          />

          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.18),transparent_30%,transparent_72%,rgba(2,6,23,0.48))]" />

          {fullscreenMode && hasControlInfo && (
            <div className="pointer-events-auto absolute left-3 bottom-[10rem] lg:left-4 lg:bottom-[14rem] max-w-md">
              <div className="rounded-2xl border border-white/16 bg-black/38 p-3 text-white shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/58">
                    Drive Status
                  </h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${
                    driveHeld
                      ? "border-emerald-300/30 bg-emerald-400/18 text-emerald-100"
                      : "border-white/14 bg-white/8 text-white/64"
                  }`}>
                    {driveHeld ? "Holding" : "Idle"}
                  </span>
                </div>

                <div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-3">
                  <div className="rounded-xl bg-white/8 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.16em] text-white/42">Drive</p>
                    <p className="mt-1 truncate text-xs font-semibold text-white/92">
                      {driveStateLabel(trackPower.left, trackPower.right)}
                    </p>
                    <p className="mt-0.5 text-[9px] font-medium text-white/50">
                      {driveHeld ? "Holding" : "Idle"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/8 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.16em] text-white/42">Input</p>
                    <p className="mt-1 truncate text-xs font-semibold text-white/92">
                      {pressedKeysLabel(lastCommand)}
                    </p>
                    <p className="mt-0.5 text-[9px] font-medium text-white/50">
                      {driveHeld ? "Holding" : "Idle"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/8 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.16em] text-white/42">Camera Aim</p>
                    <p className="mt-1 truncate text-xs font-semibold text-white/92">
                      {cameraAim.compact}
                    </p>
                    <p className="mt-0.5 text-[9px] font-medium text-white/50">
                      {displayPan}/{displayTilt} deg
                    </p>
                  </div>
                </div>

                <div className="mt-2 rounded-xl bg-white/8 px-2.5 py-2">
                  <div className="mb-1 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    <span>Tracks</span>
                    <span>L {Math.abs(trackPower.left)}% / R {Math.abs(trackPower.right)}%</span>
                  </div>
                  <div className="grid gap-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
                      <div
                        className="h-full rounded-full bg-emerald-300/80"
                        style={{ width: `${Math.abs(trackPower.left)}%` }}
                      />
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
                      <div
                        className="h-full rounded-full bg-sky-300/80"
                        style={{ width: `${Math.abs(trackPower.right)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute left-3 top-3 right-3 flex flex-wrap items-start justify-between gap-2 lg:left-4 lg:top-4 lg:right-4">
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${streamMeta.className}`}>
                {streamMeta.label}
              </span>
              <span className="rounded-full border border-white/18 bg-black/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
                Camera Stage
              </span>
            </div>

            {fullscreenMode && (
              <div className="flex flex-wrap justify-end gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${connectionState === "CONNECTED" ? "border-emerald-300/40 bg-emerald-500/20 text-emerald-50" : connectionState === "CONNECTING" ? "border-amber-300/40 bg-amber-500/20 text-amber-50" : "border-rose-300/40 bg-rose-500/20 text-rose-50"}`}>
                  {connectionState || "UNKNOWN"}
                </span>
                <span className="rounded-full border border-white/18 bg-black/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
                  Vehicle {vehicleOnline ? "ONLINE" : "OFFLINE"}
                </span>
                <span className="rounded-full border border-white/18 bg-black/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
                  Bat {typeof battery === "number" ? `${battery}%` : "-"}
                </span>
                <span className="rounded-full border border-white/18 bg-black/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
                  WiFi {typeof wifi === "number" ? `${wifi} dBm` : "-"}
                </span>
                <span className="rounded-full border border-white/18 bg-black/18 px-3 py-1 text-[11px] font-semibold tracking-wide text-white/90">
                  Ping {typeof latency === "number" ? `${latency} ms` : "- ms"}
                </span>
                <span className="rounded-full border border-white/18 bg-black/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90">
                  Profile {profileName || "-"}
                </span>
              </div>
            )}

            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                className={`pointer-events-auto rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl transition hover:-translate-y-0.5 ${fullscreenMode ? "border-white/18 bg-white/14 text-white/95" : "border-slate-200 bg-white/90 text-slate-700"}`}
              >
                {fullscreenMode ? "Exit Fullscreen" : "Fullscreen Mode"}
              </button>
            )}
          </div>

          {fullscreenMode && (
          <div className="pointer-events-none absolute left-3 right-3 top-[4.4rem] lg:left-4 lg:right-4 lg:top-[4.8rem]">
            <div className="grid gap-2 sm:max-w-xl">
              <div className="rounded-2xl border border-white/18 bg-black/30 px-3 py-2 text-white shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/60">Live camera stage</p>
                <p className="mt-0.5 text-sm font-semibold">
                  {streamStatus === "camera-off"
                    ? "Camera stream disabled"
                    : streamStatus === "no-url"
                    ? "No camera stream URL configured"
                    : streamStatus === "invalid-url"
                    ? "Stream URL must start with http(s)://"
                    : streamStatus === "error"
                    ? "Stream connection error"
                    : "Live camera feed ready"}
                </p>
              </div>
            </div>
          </div>
          )}

          {fullscreenMode && controlGuideItems.length > 0 && (
            <div className="pointer-events-none absolute right-3 top-[8.8rem] max-w-xs lg:right-4 lg:top-[9.2rem]">
              <div className="rounded-2xl border border-white/16 bg-black/34 p-3 text-white shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/58">
                    Control Guide
                  </h3>
                  <span className="rounded-full border border-white/14 bg-white/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/64">
                    {inputModeLabel}
                  </span>
                </div>

                <div className="grid gap-1.5">
                  {controlGuideItems.map((item) => (
                    <div
                      key={item.label}
                      className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 rounded-xl bg-white/8 px-2.5 py-2 text-[10px]"
                    >
                      <div>
                        <p className="font-semibold uppercase tracking-[0.14em] text-white/48">
                          {item.label}
                        </p>
                        <p className="mt-0.5 truncate text-[9px] text-white/40">
                          {item.hint}
                        </p>
                      </div>
                      <p className="self-center truncate text-right text-[11px] font-semibold text-white/90">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {fullscreenMode && onEmergencyStop && (
            <div className="pointer-events-auto absolute right-3 bottom-3 lg:right-4 lg:bottom-4">
              <button
                type="button"
                onClick={onEmergencyStop}
                className="rounded-2xl border border-rose-200/60 bg-rose-500/35 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-[0_14px_30px_rgba(225,29,72,0.16)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-rose-500/45 active:scale-95"
              >
                STOP NOW
              </button>
            </div>
          )}

          {fullscreenMode && (
            <div className="pointer-events-auto absolute left-3 bottom-3 lg:left-4 lg:bottom-4 max-w-xs">
              <div className="rounded-2xl border border-white/16 bg-black/38 p-3 text-white shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/58">Quick Actions</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                      cameraOn ? "border-emerald-300/30 bg-emerald-400/18 text-emerald-100" : "border-white/14 bg-white/8 text-white/64"
                    }`}>
                      Camera {cameraOn ? "Live" : "Off"}
                    </span>
                  </div>
                  {lastError && (
                    <p className="mb-2 rounded-lg border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-[9px] text-rose-100">
                      {lastError}
                    </p>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-1.5">
                  {onHorn && (
                    <button
                      type="button"
                      onClick={onHorn}
                      onPointerDown={() => setPressedQuickAction("horn")}
                      onPointerUp={() => setPressedQuickAction(null)}
                      onPointerLeave={() => setPressedQuickAction(null)}
                      onPointerCancel={() => setPressedQuickAction(null)}
                      onKeyDown={(event) => {
                        if (event.key === " " || event.key === "Enter") {
                          setPressedQuickAction("horn");
                        }
                      }}
                      onKeyUp={() => setPressedQuickAction(null)}
                      onBlur={() => setPressedQuickAction(null)}
                      className={`rounded-lg border px-2 py-1.5 text-[9px] font-semibold transition active:scale-95 ${
                        activeQuickAction === "horn"
                          ? "scale-95 border-orange-200/80 bg-orange-500/80 text-white shadow-inner"
                          : "border-white/16 bg-white/10 text-white/90 hover:bg-white/15"
                      }`}
                    >
                      Horn
                    </button>
                  )}
                  {onLightToggle && (
                    <button
                      type="button"
                      onClick={onLightToggle}
                      className={`rounded-lg border px-2 py-1.5 text-[9px] font-semibold transition active:scale-95 ${
                        lightOn
                          ? "border-amber-300/35 bg-amber-400/22 text-amber-50"
                          : "border-white/16 bg-white/10 text-white/90 hover:bg-white/15"
                      }`}
                    >
                      Light {lightOn ? "On" : "Off"}
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
                      onKeyDown={(event) => {
                        if (event.key === " " || event.key === "Enter") {
                          setPressedQuickAction("cameraReset");
                        }
                      }}
                      onKeyUp={() => setPressedQuickAction(null)}
                      onBlur={() => setPressedQuickAction(null)}
                      className={`rounded-lg border px-2 py-1.5 text-[9px] font-semibold transition active:scale-95 ${
                        activeQuickAction === "cameraReset"
                          ? "scale-95 border-sky-200/80 bg-sky-500/80 text-white shadow-inner"
                          : "border-white/16 bg-white/10 text-white/90 hover:bg-white/15"
                      }`}
                    >
                      Reset
                    </button>
                  )}
                  {onCameraToggle && (
                    <button
                      type="button"
                      onClick={onCameraToggle}
                      className={`rounded-lg border px-2 py-1.5 text-[9px] font-semibold transition active:scale-95 ${
                        cameraOn
                          ? "border-emerald-300/35 bg-emerald-400/22 text-emerald-50"
                          : "border-white/16 bg-white/10 text-white/90 hover:bg-white/15"
                      }`}
                    >
                      {cameraOn ? "Hide Cam" : "Show Cam"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <ControlPanelBase
      title="Camera Stream"
      className={isMobile ? "flex h-full flex-col" : "flex h-full min-h-0 flex-col"}
      contentClassName={isMobile ? "min-h-0 flex flex-1 flex-col" : "min-h-0 flex flex-1 flex-col"}
      headerClassName={isMobile ? "shrink-0" : undefined}
      titleClassName={isMobile ? "text-sm" : "text-base"}
      badge={
        <span
          className={`rounded-full border font-semibold ${streamMeta.className} ${
            isMobile ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-[11px]"
          }`}
        >
          {streamMeta.label}
        </span>
      }
    >
      <div
        className={`relative flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-100/80 text-slate-500 ${
          isMobile ? "min-h-0 flex-1" : "min-h-72 flex-1"
        }`}
      >
        {isMobile && (
          <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              vehicleOnline
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-600"
            }`}>
              {vehicleOnline ? "ON" : "OFF"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 text-[10px] text-slate-600">
              Bat <span className="font-semibold text-slate-900">{typeof battery === "number" ? `${battery}%` : "-"}</span>
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 text-[10px] text-slate-600">
              WiFi <span className="font-semibold text-slate-900">{typeof wifi === "number" ? wifi : "-"}</span>
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 text-[10px] text-slate-600">
              Ping <span className={`font-semibold ${latencyTone(latency)}`}>{latency ?? "-"} ms</span>
            </span>
          </div>
        )}
        {isMobile && hasControlInfo && (
          <div
            className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 grid grid-cols-2 gap-3 text-[10px] font-medium leading-tight text-white"
            style={{
              textShadow:
                "0 1px 2px rgba(0,0,0,0.98), 0 0 1px rgba(0,0,0,0.98)",
            }}
          >
            <ControlPanelInfoCard
              title="Track Drive Output (2 Motors)"
              className="border-white/20 bg-black/20 p-2 text-[10px] text-white"
            >
              <p>Left Track: {powerLabel(trackPower.left)}</p>
              <p>Right Track: {powerLabel(trackPower.right)}</p>
              <p>State: {driveStateLabel(trackPower.left, trackPower.right)} ? Turn Ratio {turnRatio}%</p>
              <p>Input: {pressedKeysLabel(lastCommand)}</p>
            </ControlPanelInfoCard>

            <ControlPanelInfoCard
              title="Camera Servo Aim (2 Axis)"
              className="border-white/20 bg-black/20 p-2 text-[10px] text-white"
            >
              <p>Pan: {cameraAim.panDeg} deg ({cameraAim.panLabel})</p>
              <p>Tilt: {cameraAim.tiltDeg} deg ({cameraAim.tiltLabel})</p>
              <p>Last Action: {actionLabel(lastAction)}</p>
            </ControlPanelInfoCard>
          </div>
        )}
        {effectiveFrameSrc ? (
          // Cloud relay frames are already JPEG data URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={effectiveFrameSrc}
            src={effectiveFrameSrc}
            alt="ESP32-CAM cloud frame"
            className="h-full w-full rounded-2xl object-cover"
          />
        ) : effectiveStreamUrl ? (
          // MJPEG streams from ESP32-CAM are not compatible with next/image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={effectiveStreamUrl}
            src={effectiveStreamUrl}
            alt="ESP32-CAM stream"
            className="h-full w-full rounded-2xl object-cover"
            onLoad={() =>
              setStatusByUrl((prev) => ({
                ...prev,
                [effectiveStreamUrl]: "live",
              }))
            }
            onError={() =>
              setStatusByUrl((prev) => ({
                ...prev,
                [effectiveStreamUrl]: "error",
              }))
            }
          />
        ) : (
          <span className={isMobile ? "text-sm" : "text-base"}>
            {streamStatus === "camera-off"
              ? "Camera is OFF"
              : streamStatus === "no-url"
              ? "Set ESP32-CAM URL"
              : streamStatus === "invalid-url"
              ? "Use http(s)://.../stream"
              : "Video Placeholder"}
          </span>
        )}
      </div>
    </ControlPanelBase>
  );
}
