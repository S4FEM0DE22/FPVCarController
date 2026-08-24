"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Camera,
  CarFront,
  Cloud,
  Maximize2,
  Settings2,
} from "lucide-react";

import CameraPanel from "@/components/controller/CameraPanel";
import ControllerInsightsModal from "@/components/controller/ControllerInsightsModal";
import MobileControls from "@/components/controller/MobileControls";
import MobileOverviewPanel from "@/components/controller/MobileOverviewPanel";
import OperatorStatusPanel from "@/components/controller/OperatorStatusPanel";
import SettingsPanel from "@/components/controller/SettingsPanel";
import TelemetryTrendStrip from "@/components/controller/TelemetryTrendStrip";
import TouchControlDeck from "@/components/controller/TouchControlDeck";
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
    cameraOrientation,
    cameraFrameSrc,
    cameraOnline,
    cameraStreamStatus,
    deviceLogs,
    wifiNetworks,
    wifiScanState,
    wifiScanError,
    requestWifiScan,
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
    vehicleOnline: telemetry.online,
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
  const showConnectionNotice =
    (connectionState === "DISCONNECTED" || connectionState === "ERROR") &&
    dismissedConnectionKey !== connectionModalKey;

  const profileName = telemetry.behaviorProfile?.name || softCodeProfile.name;

  const handleSharedWifiChange = async (ssid: string, password: string) => {
    handleSystemAction("WIFI_SET", { ssid, password });
  };

  const controlGuide = [
    { label: "ขับรถ", value: "W / A / S / D", hint: "เดินหน้า ถอย และเลี้ยว" },
    { label: "หันกล้อง", value: "Arrow Keys", hint: "ซ้าย ขวา ก้ม และเงย" },
    { label: "หยุดฉุกเฉิน", value: "Space", hint: "หยุดคำสั่งขับทันที" },
    { label: "คำสั่งเสริม", value: "H / L / R / X", hint: "แตร ไฟ กลางกล้อง และเปิดกล้อง" },
  ];
  const gamepadGuide = [
    { label: "ขับรถ", value: "Left Stick", hint: "คันเร่งและเลี้ยว" },
    { label: "หันกล้อง", value: "Right Stick / D-Pad", hint: "ซ้าย ขวา ก้ม และเงย" },
    { label: "คำสั่งเสริม", value: "A / B / X / Y", hint: "แตร ไฟ กล้อง และรีเซ็ต" },
    { label: "หยุดฉุกเฉิน", value: "Menu", hint: "หยุดคำสั่งขับทันที" },
  ];
  const touchGuide = [
    { label: "ขับรถ", value: "จอยซ้าย", hint: "แตะค้างแล้วลาก" },
    { label: "หันกล้อง", value: "จอยขวา", hint: "ซ้าย ขวา ก้ม และเงย" },
    { label: "คำสั่งเสริม", value: "แถบปุ่ม", hint: "แตร ไฟ กล้อง และรีเซ็ต" },
    { label: "หยุดฉุกเฉิน", value: "STOP", hint: "หยุดคำสั่งขับทันที" },
  ];
  const activeControlGuide =
    inputMode === "gamepad"
      ? gamepadGuide
      : inputMode === "touch"
      ? touchGuide
      : controlGuide;
  const activeAlert = runtimeToasts[0];
  const cameraPanDeg = cameraOrientation.pan;
  const cameraTiltDeg = cameraOrientation.tilt;
  const actionPressed = lastActionAt > 0 && inputClock - lastActionAt < 900;

  return (
    <main
      className={`relative h-dvh w-screen bg-[#e8edf1] text-slate-950 ${
        fullscreenMode ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden"
      }`}
    >
      {isMobile && fullscreenMode ? (
        <MobileControls
          onTouchCommand={handleTouchMoveWithTuning}
          onAction={handleTouchActionWithTuning}
          onStop={handleEmergencyStop}
          onOpenSettings={() => {
            setFullscreenMode(false);
            setShowSettings(true);
          }}
          onOpenInfo={() => {
            setFullscreenMode(false);
            setShowInsights(true);
          }}
          cameraOn={telemetry.cameraOn}
          lightOn={telemetry.lightOn}
          streamUrl={cameraStreamUrl}
          frameSrc={cameraFrameSrc}
          connectionState={connectionState}
          vehicleOnline={telemetry.online}
          battery={telemetry.battery}
          wifi={telemetry.wifi}
          latency={latency}
          cameraPan={cameraPanDeg}
          cameraTilt={cameraTiltDeg}
          lastCommand={lastCommand}
          lastAction={lastAction}
          actionPressed={actionPressed}
          desktop={isLandscape}
          persistentControls
          landscape={isLandscape}
          alertMessage={activeAlert?.message}
          alertLevel={activeAlert?.level}
          inputMode={inputMode}
          externalPressedQuickAction={externalPressedQuickAction}
          onExitFullscreen={() => setFullscreenMode(false)}
        />
      ) : (
        <section
          className={`relative flex flex-col ${
            fullscreenMode
              ? "h-full w-full gap-0 p-0"
              : "mx-auto min-h-dvh max-w-[1680px] gap-3 p-2.5 sm:p-3 lg:p-4"
          }`}
        >
          {!fullscreenMode && (
            <header className="sticky top-0 z-30 rounded-lg border border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur-md sm:p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase text-slate-500">FPV CAR / CAR-001</p>
                  <h1 className="truncate text-base font-bold text-slate-950 sm:text-lg">ศูนย์ควบคุมรถ</h1>
                </div>

                <div className="hidden min-w-0 flex-1 items-center justify-center gap-1.5 lg:flex">
                  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold ${connectionState === "CONNECTED" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : connectionState === "CONNECTING" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                    <Cloud size={13} /> Cloud {connectionState === "CONNECTED" ? "เชื่อมแล้ว" : connectionState === "CONNECTING" ? "กำลังเชื่อม" : "หลุด"}
                  </span>
                  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold ${telemetry.online ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                    <CarFront size={13} /> รถ {telemetry.online ? "ออนไลน์" : "ออฟไลน์"}
                  </span>
                  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold ${cameraOnline ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                    <Camera size={13} /> ESP32-CAM {cameraOnline ? "ออนไลน์" : "ออฟไลน์"}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => setShowInsights(true)} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100" title="ดู Insights" aria-label="ดู Insights">
                    <Activity size={17} />
                  </button>
                  <button onClick={() => setShowSettings(true)} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100" title="เปิดการตั้งค่า" aria-label="เปิดการตั้งค่า">
                    <Settings2 size={17} />
                  </button>
                  <button onClick={() => setFullscreenMode(true)} className="flex h-9 items-center gap-1.5 rounded-md bg-slate-950 px-2.5 text-[10px] font-bold text-white transition hover:bg-slate-800" title="เข้าโหมดเต็มจอ">
                    <Maximize2 size={16} /> <span className="hidden sm:inline">เต็มจอ</span>
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
                  : isMobile
                  ? "grid min-h-0 items-start gap-3"
                  : "grid min-h-0 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]"
              }
            >
              <div className={`min-h-0 min-w-0 ${
                fullscreenMode
                  ? "h-full"
                  : isMobile
                  ? "mobile-embedded-controller grid content-start gap-3"
                  : "grid content-start gap-3"
              }`}>
                <CameraPanel
                  isMobile={isMobile}
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

                {isMobile && !fullscreenMode && (
                  <TouchControlDeck
                    inputMode={inputMode}
                    cameraOn={telemetry.cameraOn}
                    lightOn={telemetry.lightOn}
                    onMove={handleTouchMoveWithTuning}
                    onAction={handleTouchActionWithTuning}
                    onStop={handleEmergencyStop}
                    sideBySide={isLandscape}
                    externalPressedQuickAction={externalPressedQuickAction}
                  />
                )}

                {!isMobile && !fullscreenMode && (
                  <TelemetryTrendStrip
                    connectionState={connectionState}
                    vehicleOnline={telemetry.online}
                    latency={latency}
                    battery={telemetry.battery}
                    wifi={telemetry.wifi}
                    latencySamples={latencySamples}
                    batterySamples={batterySamples}
                    wifiSamples={wifiSamples}
                  />
                )}
              </div>

              {!fullscreenMode && (
                <aside className="min-h-0">
                  {isMobile ? (
                    <MobileOverviewPanel
                      connectionState={connectionState}
                      vehicleOnline={telemetry.online}
                      cameraOn={telemetry.cameraOn}
                      cameraOnline={cameraOnline}
                      battery={telemetry.battery}
                      wifi={telemetry.wifi}
                      latency={latency}
                      cameraPan={cameraPanDeg}
                      cameraTilt={cameraTiltDeg}
                      lastCommand={lastCommand}
                      lastAction={lastAction}
                      actionPressed={actionPressed}
                      inputMode={inputMode}
                      guideItems={activeControlGuide}
                      alertMessage={activeAlert?.message}
                      alertLevel={activeAlert?.level}
                    />
                  ) : (
                    <OperatorStatusPanel
                      connectionState={connectionState}
                      vehicleOnline={telemetry.online}
                      vehicleState={telemetry.vehicleState}
                      cameraOn={telemetry.cameraOn}
                      cameraOnline={cameraOnline}
                      battery={telemetry.battery}
                      wifi={telemetry.wifi}
                      latency={latency}
                      profileName={profileName}
                      cameraPan={cameraPanDeg}
                      cameraTilt={cameraTiltDeg}
                      lastCommand={lastCommand}
                      lastAction={lastAction}
                      actionPressed={actionPressed}
                      inputMode={inputMode}
                      guideItems={activeControlGuide}
                      alertMessage={activeAlert?.message}
                      alertLevel={activeAlert?.level}
                    />
                  )}
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
        vehicleOnline={telemetry.online}
        cameraOnline={cameraOnline}
        vehicleWifiSsid={telemetry.wifiSsid}
        vehicleWifiGateway={telemetry.wifiGateway}
        cameraWifiSsid={cameraStreamStatus?.wifiSsid}
        cameraWifiGateway={cameraStreamStatus?.wifiGateway}
        cameraStreamProfile={cameraStreamStatus?.profile ?? "balanced"}
        onChangeCameraStreamProfile={async (profile) => {
          handleSystemAction("CAMERA_STREAM_PROFILE", { profile });
        }}
        wifiNetworks={wifiNetworks}
        wifiScanState={wifiScanState}
        wifiScanError={wifiScanError}
        onScanWifi={requestWifiScan}
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
        cameraStreamStatus={cameraStreamStatus}
      />

      {showConnectionNotice && !fullscreenMode && (
        <section className="fixed top-[4.75rem] left-1/2 z-40 w-[min(92vw,32rem)] -translate-x-1/2 rounded-lg border border-rose-200 bg-white/96 p-3 text-slate-900 shadow-lg backdrop-blur-md lg:top-auto lg:right-4 lg:bottom-4 lg:left-auto lg:w-[23rem] lg:translate-x-0">
          <div className="flex items-start gap-3">
            <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-950">การเชื่อมต่อ Cloud หลุด</h2>
                {reconnectAttempts > 0 && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    ลองใหม่ {reconnectAttempts}
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                {lastError || `State: ${connectionState}`}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                setShowSettings(true);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              ตั้งค่า
            </button>
            <button
              onClick={() => {
                setDismissedConnectionKey(connectionModalKey);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              ซ่อน
            </button>
            <button
              onClick={() => {
                handleSystemAction("NETWORK_RECONNECT");
              }}
              className="rounded-xl border border-emerald-300 bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600"
            >
              เชื่อมใหม่
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
