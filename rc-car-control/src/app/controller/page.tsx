"use client";

import { useCallback, useEffect, useState } from "react";

import CameraPanel from "@/components/controller/CameraPanel";
import ControllerInsightsModal from "@/components/controller/ControllerInsightsModal";
import MobileControls from "@/components/controller/MobileControls";
import SettingsPanel from "@/components/controller/SettingsPanel";
import useControllerInputHandlers from "@/hooks/useControllerInputHandlers";
import useControllerLayout from "@/hooks/useControllerLayout";
import useControllerPreferences, {
  DEFAULT_TUNING,
} from "@/hooks/useControllerPreferences";
import useControllerRuntimeMonitor from "@/hooks/useControllerRuntimeMonitor";
import useGamepadControl from "@/hooks/useGamepadControl";
import useInputMode from "@/hooks/useInputMode";
import useIsMobile from "@/hooks/useIsMobile";
import useKeyboardControl from "@/hooks/useKeyboardControl";
import useVehicleController from "@/hooks/useVehicleController";
import { NETWORK_CONFIG } from "@/constants/network";
import {
  driveStateLabel,
  formatCameraAim,
  latencyTone,
  powerLabel,
  pressedKeysLabel,
  trackPowerFromCommand,
} from "@/components/controller/controlPanelDisplay";
import {
  DEFAULT_SOFT_CODE_PROFILE,
  normalizeSoftCodeProfile,
} from "@/lib/softCodeProfile";

export default function ControllerPage() {
  const isMobile = useIsMobile();
  const [cameraStreamUrl] = useState(() => {
    if (typeof window === "undefined") return NETWORK_CONFIG.camStreamUrl;

    const storageKey = "fpv.cameraStreamUrl";
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("cam") || params.get("streamUrl");
    const fromStorage = window.localStorage.getItem(storageKey);

    if (fromQuery) {
      window.localStorage.setItem(storageKey, fromQuery);
    }

    return fromQuery || fromStorage || NETWORK_CONFIG.camStreamUrl;
  });
  const { inputMode } = useInputMode(isMobile);
  const { isLandscape, showSettings, setShowSettings, fullscreenMode, setFullscreenMode } = useControllerLayout(isMobile);

  const {
    telemetry,
    lastCommand,
    lastAction,
    lastActionAt,
    connectionState,
    latency,
    lastError,
    reconnectAttempts,
    handleKeyboardMove,
    handleKeyboardAction,
    handleGamepadMove,
    handleGamepadAction,
    handleTouchMove,
    handleTouchAction,
    handleSystemAction,
    handleEmergencyStop,
    cameraFrameSrc,
    deviceLogs,
  } = useVehicleController();

  const {
    tuning,
    setTuning,
    watchdog,
    setWatchdog,
    alertRules,
    setAlertRules,
    softCodeProfile,
    setSoftCodeProfile,
  } = useControllerPreferences();

  const {
    history,
    runtimeToasts,
    latencySamples,
    batterySamples,
    wifiSamples,
    markUserInput,
  } = useControllerRuntimeMonitor({
    alertRules,
    watchdog,
    connectionState,
    lastCommand,
    lastAction,
    latency,
    battery: telemetry.battery,
    wifi: telemetry.wifi,
    onEmergencyStop: handleEmergencyStop,
  });

  const {
    handleTouchMoveWithTuning,
    handleTouchActionWithTuning,
    handleKeyboardMoveWithWatchdog,
    handleKeyboardActionWithWatchdog,
    handleGamepadMoveWithWatchdog,
    handleGamepadActionWithWatchdog,
  } = useControllerInputHandlers({
    tuning,
    onUserInput: markUserInput,
    handleTouchMove,
    handleTouchAction,
    handleKeyboardMove,
    handleKeyboardAction,
    handleGamepadMove,
    handleGamepadAction,
  });

  const [dismissedConnectionKey, setDismissedConnectionKey] = useState("");
  const [showInsights, setShowInsights] = useState(false);
  const [inputClock, setInputClock] = useState(() => Date.now());
  const [externalPressedQuickAction, setExternalPressedQuickAction] = useState<
    "horn" | "cameraReset" | null
  >(null);

  useEffect(() => {
    if (!lastActionAt) return;
    const timer = window.setInterval(() => {
      setInputClock(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [lastActionAt]);

  const handleExternalActionPressChange = useCallback(
    (action: "HORN" | "CAM_RESET", pressed: boolean) => {
      setExternalPressedQuickAction((current) => {
        const nextAction = action === "HORN" ? "horn" : "cameraReset";

        if (pressed) return nextAction;
        return current === nextAction ? null : current;
      });
    },
    []
  );

  useKeyboardControl({
    enabled: !isMobile && inputMode === "keyboard",
    onMove: handleKeyboardMoveWithWatchdog,
    onAction: handleKeyboardActionWithWatchdog,
    onActionPressChange: handleExternalActionPressChange,
  });

  useGamepadControl({
    enabled: inputMode === "gamepad",
    onMove: handleGamepadMoveWithWatchdog,
    onAction: handleGamepadActionWithWatchdog,
    onActionPressChange: handleExternalActionPressChange,
  });

  const connectionModalKey = `${connectionState}:${reconnectAttempts}`;
  const showConnectionModal =
    (connectionState === "DISCONNECTED" || connectionState === "ERROR") &&
    dismissedConnectionKey !== connectionModalKey;

  const profileName = telemetry.behaviorProfile?.name || softCodeProfile.name;
  const trackPower = trackPowerFromCommand(lastCommand);
  const vehicleStateLabel = telemetry.online
    ? telemetry.vehicleState.toUpperCase()
    : "OFFLINE";
  const connectionTone =
    connectionState === "CONNECTED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : connectionState === "CONNECTING"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-rose-200 bg-rose-50 text-rose-700";
  const batteryTone =
    telemetry.battery > 45
      ? "text-emerald-700"
      : telemetry.battery > 20
      ? "text-amber-600"
      : "text-rose-600";
  const wifiTone =
    telemetry.wifi > -65
      ? "text-emerald-700"
      : telemetry.wifi > -78
      ? "text-amber-600"
      : "text-rose-600";

  const handleSharedWifiChange = async (ssid: string, password: string) => {
    handleSystemAction("WIFI_SET", { ssid, password });

    if (!cameraStreamUrl) return;

    const cameraUrl = new URL(cameraStreamUrl);
    const body = new URLSearchParams({
      ssid,
      password,
      controlUrl: `${window.location.origin}/controller`,
    });

    const response = await fetch(`${cameraUrl.origin}/api/wifi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      throw new Error("ESP32-CAM WiFi update failed");
    }
  };

  const controlGuide = [
    { label: "Move", value: "W / A / S / D", hint: "Keyboard drive" },
    { label: "Camera", value: "Arrow Keys", hint: "Pan / tilt" },
    { label: "Stop", value: "Space", hint: "Emergency stop" },
    { label: "Utility", value: "H / L / R / X", hint: "Horn, light, reset, camera" },
  ];
  const gamepadGuide = [
    { label: "Drive", value: "Left Stick", hint: "Throttle and steering" },
    { label: "Camera", value: "Right Stick / D-Pad", hint: "Pan and tilt" },
    { label: "Actions", value: "A / B / X / Y", hint: "Horn, light, camera, reset" },
    { label: "Stop", value: "Menu", hint: "Emergency stop" },
  ];
  const touchGuide = [
    { label: "Drive", value: "Left Pad", hint: "Hold and drag" },
    { label: "Camera", value: "Right Pad", hint: "Pan and tilt" },
    { label: "Actions", value: "Bottom Bar", hint: "Horn, light, camera" },
    { label: "Stop", value: "STOP", hint: "Emergency stop" },
  ];
  const activeControlGuide =
    inputMode === "gamepad"
      ? gamepadGuide
      : inputMode === "touch"
      ? touchGuide
      : controlGuide;
  const activeAlert = runtimeToasts[0];
  const cameraPanDeg = telemetry.cameraPan;
  const cameraTiltDeg = telemetry.cameraTilt;
  const cameraAim = formatCameraAim(cameraPanDeg, cameraTiltDeg);
  const actionPressed = lastActionAt > 0 && inputClock - lastActionAt < 900;
  const activeInputState = [
    {
      label: "Drive",
      value: lastCommand,
      active: lastCommand !== "STOP",
      state: lastCommand !== "STOP" ? "Holding" : "Idle",
    },
    {
      label: "Move Keys",
      value: pressedKeysLabel(lastCommand),
      active: lastCommand !== "STOP",
      state: lastCommand !== "STOP" ? "Holding" : "Idle",
    },
    {
      label: "Camera",
      value: lastAction.startsWith("CAM_") ? lastAction : "-",
      active: actionPressed && lastAction.startsWith("CAM_"),
      state: actionPressed && lastAction.startsWith("CAM_") ? "Pressed" : "Idle",
    },
    {
      label: "Utility",
      value: ["HORN", "LIGHT_TOGGLE", "CAMERA_TOGGLE"].includes(lastAction)
        ? lastAction
        : "-",
      active: actionPressed && ["HORN", "LIGHT_TOGGLE", "CAMERA_TOGGLE"].includes(lastAction),
      state:
        actionPressed && ["HORN", "LIGHT_TOGGLE", "CAMERA_TOGGLE"].includes(lastAction)
          ? "Pressed"
          : "Idle",
    },
  ];

  return (
    <main
      className={`relative h-dvh w-screen bg-slate-950 text-slate-950 ${
        !isMobile && !fullscreenMode ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_12%,rgba(13,148,136,0.22),transparent_26%),radial-gradient(circle_at_90%_8%,rgba(245,158,11,0.2),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0))]" />

      {isMobile ? (
        <MobileControls
          onTouchCommand={handleTouchMoveWithTuning}
          onAction={handleTouchActionWithTuning}
          onStop={handleEmergencyStop}
          onOpenSettings={() => setShowSettings(true)}
          onOpenInfo={() => setShowInsights(true)}
          cameraOn={telemetry.cameraOn}
          lightOn={telemetry.lightOn}
          streamUrl={cameraStreamUrl}
          frameSrc={cameraFrameSrc}
          connectionState={connectionState}
          battery={telemetry.battery}
          wifi={telemetry.wifi}
          latency={latency}
          cameraPan={cameraPanDeg}
          cameraTilt={cameraTiltDeg}
          lastCommand={lastCommand}
          lastAction={lastAction}
          lastActionAt={lastActionAt}
          actionPressed={actionPressed}
          desktop={isLandscape}
          persistentControls={isLandscape}
          landscape={isLandscape}
          alertMessage={activeAlert?.message}
          alertLevel={activeAlert?.level}
          inputMode={inputMode}
          externalPressedQuickAction={externalPressedQuickAction}
        />
      ) : (
        <section
          className={`relative mx-auto flex max-w-[1800px] flex-col gap-3 px-3 py-3 lg:px-5 lg:py-5 ${
            fullscreenMode ? "h-full" : "min-h-dvh"
          }`}
        >
          {!fullscreenMode && (
            <header className="rounded-[1.75rem] border border-white/72 bg-white/86 px-4 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:px-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                    Dashboard
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-3xl">
                      FPV Car Control Center
                    </h1>
                  </div>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                    หน้าควบคุมรถแบบ stage-first ที่เน้นภาพกล้องเป็นศูนย์กลาง และย้ายสถานะสำคัญไปไว้บนจอภาพโดยตรง
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    onClick={() => setShowInsights(true)}
                    className="rounded-2xl border border-white/70 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
                  >
                    Insights
                  </button>
                  <button
                    onClick={() => setShowSettings((prev) => !prev)}
                    className="rounded-2xl border border-white/70 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
                  >
                    {showSettings ? "Hide Settings" : "Settings"}
                  </button>
                </div>
              </div>
            </header>
          )}

          <div className="grid min-h-0 flex-1 gap-3">
            <div
              className={
                fullscreenMode
                  ? "grid min-h-0 gap-3"
                  : "grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_23rem]"
              }
            >
              <CameraPanel
                isMobile={false}
                cameraEnabled={telemetry.cameraOn}
                streamUrl={cameraStreamUrl}
                frameSrc={cameraFrameSrc}
                lastCommand={lastCommand}
                lastAction={lastAction}
                actionPressed={actionPressed}
                cameraPan={cameraPanDeg}
                cameraTilt={cameraTiltDeg}
                fullscreen
                connectionState={connectionState}
                vehicleOnline={telemetry.online}
                battery={telemetry.battery}
                wifi={telemetry.wifi}
                latency={latency}
                profileName={profileName}
                fullscreenMode={fullscreenMode}
                onToggleFullscreen={() => setFullscreenMode((prev) => !prev)}
                onEmergencyStop={handleEmergencyStop}
                lastError={lastError}
                cameraOn={telemetry.cameraOn}
                lightOn={telemetry.lightOn}
                onHorn={() => handleSystemAction("HORN")}
                onLightToggle={() => handleSystemAction("LIGHT_TOGGLE")}
                onCameraReset={() => handleSystemAction("CAM_RESET")}
                onCameraToggle={() => handleSystemAction("CAMERA_TOGGLE")}
                externalPressedQuickAction={externalPressedQuickAction}
                inputModeLabel={inputMode.toUpperCase()}
                controlGuideItems={activeControlGuide}
              />

              {!fullscreenMode && (
                <aside className="grid min-h-0 gap-3 xl:grid-rows-[auto_auto_minmax(0,1fr)]">
                  <section className="rounded-2xl border border-white/72 bg-white/88 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                          Vehicle Status
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-950">
                          {vehicleStateLabel}
                        </h2>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${connectionTone}`}>
                        {connectionState}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Battery</p>
                        <p className={`mt-1 text-base font-semibold ${batteryTone}`}>{telemetry.battery}%</p>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">WiFi</p>
                        <p className={`mt-1 text-base font-semibold ${wifiTone}`}>{telemetry.wifi} dBm</p>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Latency</p>
                        <p className={`mt-1 text-base font-semibold ${latencyTone(latency)}`}>{latency ?? "-"} ms</p>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Profile</p>
                        <p className="mt-1 truncate text-base font-semibold text-slate-900">{profileName}</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                          Camera Aim
                        </p>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-900">
                            {cameraAim.compact}
                          </p>
                          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                            Pan {cameraAim.panDeg} deg / Tilt {cameraAim.tiltDeg} deg
                          </p>
                        </div>
                      </div>
                    </div>
                    {activeAlert && (
                      <div
                        className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${
                          activeAlert.level === "warn"
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-sky-200 bg-sky-50 text-sky-900"
                        }`}
                      >
                        {activeAlert.message}
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-white/72 bg-white/88 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                      Drive Output
                    </p>
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                          <span>Left Track</span>
                          <span>{powerLabel(trackPower.left)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${Math.abs(trackPower.left)}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                          <span>Right Track</span>
                          <span>{powerLabel(trackPower.right)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-sky-500 transition-all"
                            style={{ width: `${Math.abs(trackPower.right)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Drive</p>
                        <p className="mt-1 font-semibold text-slate-900">
                          {driveStateLabel(trackPower.left, trackPower.right)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Input</p>
                        <p className="mt-1 font-semibold text-slate-900">{pressedKeysLabel(lastCommand)}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Input State
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {activeInputState.map((item) => (
                          <div
                            key={item.label}
                            className={`rounded-lg border px-2.5 py-2 ${
                              item.active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-slate-200 bg-white text-slate-500"
                            }`}
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                              {item.label}
                            </p>
                            <p className="mt-1 truncate text-xs font-semibold">
                              {item.value}
                            </p>
                            <p className="mt-0.5 text-[10px] font-medium">
                              {item.state}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="min-h-0 rounded-2xl border border-white/72 bg-white/88 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Control Guide
                      </p>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                        {inputMode.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2">
                      {activeControlGuide.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2"
                        >
                          <div>
                            <p className="text-xs font-semibold text-slate-900">{item.label}</p>
                            <p className="text-[11px] text-slate-500">{item.hint}</p>
                          </div>
                          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                </aside>
              )}
            </div>
          </div>
        </section>
      )}

      <SettingsPanel
        open={showSettings && !fullscreenMode}
        onClose={() => setShowSettings(false)}
        onChangeWifi={handleSharedWifiChange}
        onReconnectVehicle={async () => {
          handleSystemAction("NETWORK_RECONNECT");
        }}
        onRebootVehicle={async () => {
          handleSystemAction("REBOOT");
        }}
        onOpenWifiPortal={async () => {
          handleSystemAction("WIFI_PORTAL_OPEN");
        }}
        softCodeProfile={softCodeProfile}
        onApplySoftCodeProfile={async (profile) => {
          const normalized = normalizeSoftCodeProfile(profile);
          setSoftCodeProfile(normalized);
          handleSystemAction("PROFILE_APPLY", { profile: normalized });
        }}
        onResetSoftCodeProfile={async () => {
          setSoftCodeProfile(DEFAULT_SOFT_CODE_PROFILE);
          handleSystemAction("PROFILE_APPLY", { profile: DEFAULT_SOFT_CODE_PROFILE });
        }}
        tuning={tuning}
        onChangeTuning={setTuning}
        onResetTuning={() => setTuning(DEFAULT_TUNING)}
        watchdog={watchdog}
        onChangeWatchdog={setWatchdog}
        alertRules={alertRules}
        onChangeAlertRules={setAlertRules}
      />

      <ControllerInsightsModal
        open={showInsights && !fullscreenMode}
        onClose={() => setShowInsights(false)}
        telemetry={telemetry}
        connectionState={connectionState}
        latency={latency}
        lastError={lastError}
        history={history}
        lastCommand={lastCommand}
        lastAction={lastAction}
        latencySamples={latencySamples}
        batterySamples={batterySamples}
        wifiSamples={wifiSamples}
        deviceLogs={deviceLogs}
      />

      {showConnectionModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-lg backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-3 w-3 rounded-full bg-rose-500" />
              <h2 className="text-lg font-semibold text-slate-900">Connection Lost</h2>
            </div>

            <p className="mt-3 text-sm text-slate-600">
              {lastError || `State: ${connectionState}`}
            </p>

            {reconnectAttempts > 0 && (
              <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
                Reconnection attempt {reconnectAttempts}...
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setShowSettings(true);
                }}
                className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Settings
              </button>
              <button
                onClick={() => {
                  setDismissedConnectionKey(connectionModalKey);
                }}
                className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  handleSystemAction("NETWORK_RECONNECT");
                }}
                className="flex-1 rounded-full border border-emerald-300 bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
              >
                Reconnect Now
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
