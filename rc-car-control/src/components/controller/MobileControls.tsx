"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CameraJoystick from "@/components/controller/CameraJoystick";
import DriveJoystick from "@/components/controller/DriveJoystick";
import MobileActionBar from "@/components/controller/MobileActionBar";
import MobileStatusBar from "@/components/controller/MobileStatusBar";
import VideoStream from "@/components/controller/VideoStream";
import type { ActionCommand, ControlCommand, InputMode } from "@/types/control";

interface MobileControlsProps {
  onTouchCommand: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  onAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onOpenInfo?: () => void;
  cameraOn: boolean;
  lightOn: boolean;
  streamUrl?: string;
  frameSrc?: string;
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
  desktop?: boolean;
  persistentControls?: boolean;
  landscape?: boolean;
  alertMessage?: string;
  alertLevel?: "warn" | "info";
  inputMode?: InputMode;
  externalPressedQuickAction?: "horn" | "cameraReset" | null;
}

export default function MobileControls({
  onTouchCommand,
  onAction,
  onStop,
  onOpenSettings,
  onOpenInfo,
  cameraOn,
  lightOn,
  streamUrl = "",
  frameSrc = "",
  connectionState,
  battery,
  wifi,
  latency,
  cameraPan,
  cameraTilt,
  lastCommand,
  lastAction,
  lastActionAt,
  actionPressed,
  desktop = false,
  persistentControls = false,
  landscape = true,
  alertMessage,
  alertLevel,
  inputMode = "touch",
  externalPressedQuickAction = null,
}: MobileControlsProps) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const joystickSize = desktop ? 176 : landscape ? 132 : 112;
  const compactPortrait = !desktop && !landscape;
  const showVirtualJoysticks = inputMode !== "gamepad";

  const scheduleHide = useCallback(() => {
    if (persistentControls) {
      return;
    }

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }

    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 5000);
  }, [persistentControls]);

  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (persistentControls) {
      return;
    }

    scheduleHide();
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [persistentControls, scheduleHide]);

  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyTouchAction = document.body.style.touchAction;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    if (desktop) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.touchAction = prevBodyTouchAction;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [desktop]);

  const controlsVisibilityClass = controlsVisible
    ? "opacity-100"
    : "opacity-0 pointer-events-none";

  return (
    <section
      className={`mobile-controller ${desktop ? "desktop-controller" : ""} ${
        compactPortrait ? "portrait-controller" : "landscape-controller"
      }`}
      onPointerDown={wakeControls}
      onPointerMove={wakeControls}
      onTouchStart={wakeControls}
      onTouchMove={wakeControls}
    >
      <VideoStream streamUrl={streamUrl} frameSrc={frameSrc} cameraOn={cameraOn} />

      <div className={`absolute inset-0 transition-opacity duration-300 ${controlsVisibilityClass}`}>
        <MobileStatusBar
          connectionState={connectionState}
          battery={battery}
          wifi={wifi}
          latency={latency}
          cameraPan={cameraPan}
          cameraTilt={cameraTilt}
          lastCommand={lastCommand}
          lastAction={lastAction}
          lastActionAt={lastActionAt}
          actionPressed={actionPressed}
          onSettings={onOpenSettings}
          onInfo={onOpenInfo}
          desktop={desktop}
          compact={compactPortrait}
          alertMessage={alertMessage}
          alertLevel={alertLevel}
          inputMode={inputMode}
        />

        {showVirtualJoysticks && (
          <>
            <DriveJoystick onMove={onTouchCommand} size={joystickSize} />

            <CameraJoystick onAction={onAction} size={joystickSize} />
          </>
        )}

        <MobileActionBar
          cameraOn={cameraOn}
          lightOn={lightOn}
          onCameraToggle={() => onAction("CAMERA_TOGGLE")}
          onCameraReset={() => onAction("CAM_RESET")}
          onLightToggle={() => onAction("LIGHT_TOGGLE")}
          onHorn={() => onAction("HORN")}
          onStop={onStop}
          desktop={desktop}
          compact={compactPortrait}
          externalPressedQuickAction={externalPressedQuickAction}
        />
      </div>

      {!persistentControls && !controlsVisible && (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[11px] text-white"
          onClick={wakeControls}
        >
          Show controls
        </button>
      )}
    </section>
  );
}
