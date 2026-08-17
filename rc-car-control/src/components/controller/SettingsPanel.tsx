"use client";

import { useEffect, useState } from "react";
import {
  CarFront,
  Cloud,
  Eye,
  EyeOff,
  Check,
  LockKeyhole,
  Power,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  DEFAULT_SOFT_CODE_PROFILE,
  normalizeSoftCodeProfile,
  SOFT_CODE_PRESETS,
} from "@/lib/softCodeProfile";
import { NETWORK_CONFIG } from "@/constants/network";
import type { VehicleSoftCodeProfile } from "@/types/control";
import type { CameraStreamProfile, WifiNetwork } from "@/types/socket";
import type { WifiScanState } from "@/hooks/useVehicleController";
import type {
  ControllerAlertRules,
  ControllerTuningSettings,
  ControllerWatchdogSettings,
} from "@/components/controller/ControllerInsightsModal";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onChangeWifi: (ssid: string, password: string) => Promise<void> | void;
  vehicleOnline: boolean;
  cameraOnline: boolean;
  cameraStreamProfile: CameraStreamProfile;
  onChangeCameraStreamProfile: (profile: CameraStreamProfile) => Promise<void> | void;
  wifiNetworks: WifiNetwork[];
  wifiScanState: WifiScanState;
  wifiScanError: string;
  onScanWifi: () => void;
  onReconnectVehicle: () => Promise<void> | void;
  onRebootVehicle: () => Promise<void> | void;
  onOpenWifiPortal: () => Promise<void> | void;
  softCodeProfile: VehicleSoftCodeProfile;
  onApplySoftCodeProfile: (profile: VehicleSoftCodeProfile) => Promise<void> | void;
  onResetSoftCodeProfile: () => Promise<void> | void;
  tuning: ControllerTuningSettings;
  onChangeTuning: (next: ControllerTuningSettings) => void;
  onResetTuning: () => void;
  watchdog: ControllerWatchdogSettings;
  onChangeWatchdog: (next: ControllerWatchdogSettings) => void;
  alertRules: ControllerAlertRules;
  onChangeAlertRules: (next: ControllerAlertRules) => void;
}

type ConfirmActionState = {
  title: string;
  description: string;
  successMessage: string;
  action: () => Promise<void> | void;
};

type SettingsTab = "network" | "control" | "vehicle";

export default function SettingsPanel({
  open,
  onClose,
  onChangeWifi,
  vehicleOnline,
  cameraOnline,
  cameraStreamProfile,
  onChangeCameraStreamProfile,
  wifiNetworks,
  wifiScanState,
  wifiScanError,
  onScanWifi,
  onReconnectVehicle,
  onRebootVehicle,
  onOpenWifiPortal,
  softCodeProfile,
  onApplySoftCodeProfile,
  onResetSoftCodeProfile,
  tuning,
  onChangeTuning,
  onResetTuning,
  watchdog,
  onChangeWatchdog,
  alertRules,
  onChangeAlertRules,
}: SettingsPanelProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(null);
  const [profileDraft, setProfileDraft] = useState<VehicleSoftCodeProfile>(softCodeProfile);
  const [profileError, setProfileError] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("network");
  const cloudUrl = NETWORK_CONFIG.cloudUrl || "Local / custom WebSocket";
  const wsUrl = NETWORK_CONFIG.wsUrl;
  const selectedNetwork = wifiNetworks.find((network) => network.ssid === ssid);
  const networkReady =
    vehicleOnline &&
    Boolean(selectedNetwork) &&
    (!selectedNetwork?.secure || password.length > 0);

  useEffect(() => {
    if (
      open &&
      activeTab === "network" &&
      vehicleOnline &&
      wifiScanState === "idle"
    ) {
      onScanWifi();
    }
  }, [activeTab, onScanWifi, open, vehicleOnline, wifiScanState]);

  useEffect(() => {
    if (!open) return;
    setProfileDraft(softCodeProfile);
    setProfileError("");
  }, [open, softCodeProfile]);

  if (!open) return null;

  const handleWifiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextSsid = ssid.trim();

    if (!nextSsid) {
      setMessage("กรุณาเลือก Wi-Fi หรือ Hotspot จากรายการก่อนส่งค่า");
      return;
    }

    if (selectedNetwork?.secure && !password) {
      setMessage("กรุณาใส่รหัสผ่านของเครือข่ายที่เลือก");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      await onChangeWifi(nextSsid, password);
      setMessage("ส่งค่า WiFi ไปที่ ESP32 และ ESP32-CAM แล้ว");
      setPassword("");
    } catch {
      setMessage("ส่งค่า WiFi ไปที่รถแล้ว แต่ ESP32-CAM อาจอัปเดตไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (
    action: () => Promise<void> | void,
    successMessage: string
  ) => {
    setSubmitting(true);
    setMessage("");

    try {
      await action();
      setMessage(successMessage);
    } catch {
      setMessage("ส่งคำสั่งไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  const requestConfirmAction = (config: ConfirmActionState) => {
    setConfirmAction(config);
  };

  const confirmAndRunAction = async () => {
    if (!confirmAction) return;
    const { action, successMessage } = confirmAction;
    setConfirmAction(null);
    await runAction(action, successMessage);
  };

  const applyProfilePreset = (preset: keyof typeof SOFT_CODE_PRESETS) => {
    setProfileDraft(SOFT_CODE_PRESETS[preset]);
    setProfileError("");
  };

  const handleSoftCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");
    setProfileError("");

    try {
      const normalized = normalizeSoftCodeProfile(profileDraft);
      setProfileDraft(normalized);
      await onApplySoftCodeProfile(normalized);
      setMessage(`Applied soft code profile: ${normalized.name}`);
    } catch {
      setProfileError("ค่าพฤติกรรมไม่ถูกต้อง หรืออยู่นอกช่วงที่รองรับ");
    } finally {
      setSubmitting(false);
    }
  };

  const applyControlPreset = (preset: "beginner" | "indoor" | "sport") => {
    if (preset === "beginner") {
      onChangeTuning({
        touchSteeringGain: 0.8,
        touchThrottleGain: 0.75,
        touchDeadzone: 0.12,
        cameraActionGain: 0.8,
      });
      return;
    }

    if (preset === "indoor") {
      onChangeTuning({
        touchSteeringGain: 0.95,
        touchThrottleGain: 0.85,
        touchDeadzone: 0.1,
        cameraActionGain: 0.9,
      });
      return;
    }

    onChangeTuning({
      touchSteeringGain: 1.25,
      touchThrottleGain: 1.2,
      touchDeadzone: 0.05,
      cameraActionGain: 1.25,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-3 backdrop-blur-xl sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        className="glass-modal relative flex h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg p-4 text-neutral-900 sm:h-[min(44rem,calc(100dvh-2rem))] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-2 sm:mb-5">
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-500">Vehicle configuration</p>
            <h2 className="text-base font-bold sm:text-lg">ตั้งค่ารถ</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
            title="ปิดหน้าตั้งค่า"
            aria-label="ปิดหน้าตั้งค่า"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mb-4 flex shrink-0 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("network")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition ${
              activeTab === "network"
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-white/70"
            }`}
          >
            <Wifi size={14} /> เครือข่าย
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("control")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition ${
              activeTab === "control"
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-white/70"
            }`}
          >
            <SlidersHorizontal size={14} /> การควบคุม
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("vehicle")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition ${
              activeTab === "vehicle"
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-white/70"
            }`}
          >
            <CarFront size={14} /> ตัวรถ
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {activeTab === "network" ? (
            <>
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cloud size={17} />
                    <div>
                      <h3 className="text-sm font-semibold">ปลายทางควบคุม</h3>
                      <p className="text-[10px] text-sky-700">เว็บส่งคำสั่งผ่าน WebSocket</p>
                    </div>
                  </div>
                  <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-sky-800">
                    {NETWORK_CONFIG.cloudUrl ? "Cloud" : "ในเครื่อง"}
                  </span>
                </div>
                <details className="mt-3 rounded-md border border-sky-200 bg-white/70 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-sky-800">ดูรายละเอียดทางเทคนิค</summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-sky-500">Controller URL</p>
                      <p className="mt-0.5 break-all font-medium text-slate-800">{cloudUrl}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-sky-500">WebSocket</p>
                      <p className="mt-0.5 break-all font-medium text-slate-800">{wsUrl}</p>
                    </div>
                  </div>
                </details>
              </div>

              <form
                onSubmit={handleWifiSubmit}
                className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Wifi size={17} className="text-emerald-700" />
                  <h3 className="text-sm font-semibold text-neutral-800">เปลี่ยน Wi-Fi ของรถ</h3>
                </div>
                <p className="mb-3 text-xs leading-5 text-slate-500">
                  ESP32 จะสแกนเครือข่ายที่อยู่ใกล้รถ เลือกชื่อจากรายการแล้วใส่รหัสผ่านเพียงครั้งเดียว
                </p>

                <div className="space-y-3">
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label className="block text-xs font-medium text-neutral-600">
                        1. เลือกเครือข่ายใกล้รถ
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setSsid("");
                          setPassword("");
                          setMessage("");
                          onScanWifi();
                        }}
                        disabled={!vehicleOnline || wifiScanState === "scanning"}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw
                          size={14}
                          className={wifiScanState === "scanning" ? "animate-spin" : ""}
                        />
                        {wifiScanState === "scanning" ? "กำลังสแกน" : "สแกนใหม่"}
                      </button>
                    </div>

                    {wifiScanState === "scanning" ? (
                      <div className="grid min-h-24 place-items-center rounded-md border border-slate-200 bg-slate-50 text-center">
                        <div>
                          <RefreshCw size={20} className="mx-auto animate-spin text-emerald-600" />
                          <p className="mt-2 text-xs text-slate-600">กำลังให้ ESP32 ค้นหาเครือข่าย...</p>
                        </div>
                      </div>
                    ) : wifiNetworks.length > 0 ? (
                      <>
                        <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-1.5">
                        {wifiNetworks.map((network) => {
                          const selected = network.ssid === ssid;
                          const signal =
                            network.rssi >= -55
                              ? "แรงมาก"
                              : network.rssi >= -67
                              ? "ดี"
                              : network.rssi >= -75
                              ? "พอใช้"
                              : "อ่อน";

                          return (
                            <button
                              key={network.ssid}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setSsid(network.ssid);
                                setPassword("");
                                setMessage("");
                              }}
                              className={`flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition ${
                                selected
                                  ? "border-emerald-500 bg-emerald-50"
                                  : "border-transparent bg-white hover:border-slate-200"
                              }`}
                            >
                              <Wifi
                                size={18}
                                className={selected ? "text-emerald-700" : "text-slate-500"}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-slate-900">
                                  {network.ssid}
                                </span>
                                <span className="block text-[11px] text-slate-500">
                                  {signal} · {network.rssi} dBm · ช่อง {network.channel || "—"}
                                </span>
                              </span>
                              {network.secure && (
                                <LockKeyhole size={14} className="shrink-0 text-slate-400" />
                              )}
                              {selected && <Check size={18} className="shrink-0 text-emerald-700" />}
                            </button>
                          );
                        })}
                        </div>
                        {!vehicleOnline && (
                          <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
                            <WifiOff size={16} className="shrink-0" />
                            รายการสแกนล่าสุดยังดูได้ แต่ต้องรอ ESP32 ออนไลน์ก่อนส่งค่า
                          </div>
                        )}
                      </>
                    ) : !vehicleOnline ? (
                      <div className="flex min-h-24 items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm text-amber-950">
                        <WifiOff size={20} className="shrink-0" />
                        <p>ESP32 ยังไม่ออนไลน์ จึงยังสแกน Wi-Fi รอบตัวรถไม่ได้</p>
                      </div>
                    ) : wifiScanState === "error" ? (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-xs leading-5 text-rose-800">
                        {wifiScanError || "สแกน Wi-Fi ไม่สำเร็จ กรุณาลองอีกครั้ง"}
                      </div>
                    ) : wifiScanState === "ready" ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                        ไม่พบ Wi-Fi หรือ Hotspot ใกล้รถ ลองเปิด Hotspot แล้วกดสแกนใหม่
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={onScanWifi}
                        className="flex min-h-24 w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm font-semibold text-slate-700"
                      >
                        <Wifi size={18} /> สแกนหา Wi-Fi
                      </button>
                    )}
                  </div>

                  {selectedNetwork?.secure ? (
                    <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-xs text-neutral-500">
                        2. รหัสผ่านของ {selectedNetwork.ssid}
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="grid h-7 w-8 place-items-center rounded-md border border-slate-200 bg-slate-50 text-slate-600"
                        title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                        aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="ใส่รหัสผ่าน Wi-Fi"
                      autoComplete="new-password"
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-emerald-400"
                    />
                    </div>
                  ) : selectedNetwork ? (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      <Check size={15} /> เครือข่ายนี้ไม่ต้องใช้รหัสผ่าน
                    </div>
                  ) : null}

                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
                    รถจะขาดการเชื่อมต่อชั่วคราว หากไม่กลับมาออนไลน์ ให้เข้า FPV-Car-Setup เพื่อตั้งค่าใหม่
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !networkReady}
                    className="w-full rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting
                      ? "กำลังส่งค่า..."
                      : !vehicleOnline
                      ? "รอ ESP32 ออนไลน์"
                      : selectedNetwork
                      ? `ใช้ ${selectedNetwork.ssid} กับรถ`
                      : "เลือก Wi-Fi ก่อน"}
                  </button>
                </div>
              </form>

              <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                <h3 className="mb-3 text-sm font-semibold text-neutral-800">
                  คำสั่งเครือข่ายเพิ่มเติม
                </h3>

                <div className="grid gap-3">
                  <button
                    onClick={() =>
                      requestConfirmAction({
                        title: "Reconnect Vehicle Network?",
                        description:
                          "The vehicle network stack will reconnect and commands may pause briefly.",
                        successMessage: "ส่งคำสั่ง reconnect แล้ว",
                        action: onReconnectVehicle,
                      })
                    }
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-neutral-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    <RefreshCw size={16} /> เชื่อมต่อเครือข่ายรถใหม่
                  </button>

                  <button
                    onClick={() =>
                      requestConfirmAction({
                        title: "Open WiFi Setup Mode?",
                        description:
                          "Vehicle may switch to setup mode and disconnect normal remote control until reconfigured.",
                        successMessage: "สั่งเปิด WiFi setup mode แล้ว",
                        action: onOpenWifiPortal,
                      })
                    }
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
                  >
                    <Radio size={16} /> เปิดโหมด FPV-Car-Setup
                  </button>

                  <button
                    onClick={() =>
                      requestConfirmAction({
                        title: "Reboot Vehicle?",
                        description:
                          "Vehicle will restart and all active control/telemetry sessions will disconnect temporarily.",
                        successMessage: "ส่งคำสั่ง reboot แล้ว",
                        action: onRebootVehicle,
                      })
                    }
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
                  >
                    <Power size={16} /> รีสตาร์ตรถ
                  </button>
                </div>
              </div>
            </>
          ) : activeTab === "control" ? (
            <div className="space-y-4 rounded-2xl glass-chip p-3 sm:p-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-800">
                  Controller Feel
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  These settings affect browser input before commands are sent to the vehicle.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs text-slate-500">Quick Presets</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyControlPreset("beginner")}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Beginner
                  </button>
                  <button
                    type="button"
                    onClick={() => applyControlPreset("indoor")}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Indoor
                  </button>
                  <button
                    type="button"
                    onClick={() => applyControlPreset("sport")}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Sport
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Touch Steering Gain ({tuning.touchSteeringGain.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={1.8}
                  step={0.05}
                  value={tuning.touchSteeringGain}
                  onChange={(e) =>
                    onChangeTuning({
                      ...tuning,
                      touchSteeringGain: Number(e.target.value),
                    })
                  }
                  className="w-full accent-slate-950"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Touch Throttle Gain ({tuning.touchThrottleGain.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={1.8}
                  step={0.05}
                  value={tuning.touchThrottleGain}
                  onChange={(e) =>
                    onChangeTuning({
                      ...tuning,
                      touchThrottleGain: Number(e.target.value),
                    })
                  }
                  className="w-full accent-slate-950"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Touch Deadzone ({tuning.touchDeadzone.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0}
                  max={0.35}
                  step={0.01}
                  value={tuning.touchDeadzone}
                  onChange={(e) =>
                    onChangeTuning({
                      ...tuning,
                      touchDeadzone: Number(e.target.value),
                    })
                  }
                  className="w-full accent-slate-950"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Camera Action Gain ({tuning.cameraActionGain.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0.4}
                  max={1.8}
                  step={0.05}
                  value={tuning.cameraActionGain}
                  onChange={(e) =>
                    onChangeTuning({
                      ...tuning,
                      cameraActionGain: Number(e.target.value),
                    })
                  }
                  className="w-full accent-slate-950"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onResetTuning}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Reset Defaults
                </button>
              </div>

              <div className="rounded-xl bg-white/45 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-800">Auto Safety Watchdog</h4>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={watchdog.enabled}
                      onChange={(e) =>
                        onChangeWatchdog({
                          ...watchdog,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    Enabled
                  </label>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Send STOP automatically when no user input is detected for the timeout duration.
                </p>
                <div className="mt-2">
                  <label className="mb-1 block text-xs text-slate-500">
                    Timeout ({Math.round(watchdog.timeoutMs / 1000)}s)
                  </label>
                  <input
                    type="range"
                    min={1000}
                    max={12000}
                    step={500}
                    value={watchdog.timeoutMs}
                    onChange={(e) =>
                      onChangeWatchdog({
                        ...watchdog,
                        timeoutMs: Number(e.target.value),
                      })
                    }
                    className="w-full accent-slate-950"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-white/45 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-800">Telemetry Alert Rules</h4>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={alertRules.enabled}
                      onChange={(e) =>
                        onChangeAlertRules({
                          ...alertRules,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    Enabled
                  </label>
                </div>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">
                      Battery Warning Below ({alertRules.batteryBelow}%)
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={60}
                      step={1}
                      value={alertRules.batteryBelow}
                      onChange={(e) =>
                        onChangeAlertRules({
                          ...alertRules,
                          batteryBelow: Number(e.target.value),
                        })
                      }
                      className="w-full accent-slate-950"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">
                      Latency Warning Above ({alertRules.latencyAbove} ms)
                    </label>
                    <input
                      type="range"
                      min={60}
                      max={500}
                      step={10}
                      value={alertRules.latencyAbove}
                      onChange={(e) =>
                        onChangeAlertRules({
                          ...alertRules,
                          latencyAbove: Number(e.target.value),
                        })
                      }
                      className="w-full accent-slate-950"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">
                      WiFi Warning Below ({alertRules.wifiBelow} dBm)
                    </label>
                    <input
                      type="range"
                      min={-95}
                      max={-45}
                      step={1}
                      value={alertRules.wifiBelow}
                      onChange={(e) =>
                        onChangeAlertRules({
                          ...alertRules,
                          wifiBelow: Number(e.target.value),
                        })
                      }
                      className="w-full accent-slate-950"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleSoftCodeSubmit}
              className="rounded-2xl glass-chip p-3 sm:p-4"
            >
              <div className="mb-4 border-b border-slate-200 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">ความลื่นของภาพ</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      กล้องจะลดรายละเอียดขณะหันเพื่อลดภาพค้าง แล้วเพิ่มความชัดกลับเมื่อหยุด
                    </p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-semibold ${cameraOnline ? "text-emerald-700" : "text-slate-400"}`}>
                    {cameraOnline ? "กล้องออนไลน์" : "รอกล้อง"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1">
                  {([
                    ["realtime", "ลื่น"],
                    ["balanced", "สมดุล"],
                    ["quality", "ชัด"],
                  ] as const).map(([profile, label]) => (
                    <button
                      key={profile}
                      type="button"
                      disabled={!cameraOnline}
                      onClick={async () => {
                        await onChangeCameraStreamProfile(profile);
                        setMessage(`ส่งโหมดภาพ ${label} ไปยัง ESP32-CAM แล้ว`);
                      }}
                      className={`rounded-md px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                        cameraStreamProfile === profile
                          ? "bg-slate-950 text-white shadow-sm"
                          : "text-slate-600 hover:bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  สมดุลเหมาะกับการใช้งานทั่วไป · ลื่นเหมาะกับการขับ · ชัดเหมาะกับตอนรถหยุด
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-neutral-800">
                  Soft Code Studio
                </h3>
                <span className="rounded-full border border-white/50 bg-white/65 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  Behavior Profile
                </span>
              </div>

              <p className="mt-2 text-xs leading-5 text-slate-500">
                ปรับพฤติกรรมรถแบบแยกฟิลด์เพื่อไม่ต้องแก้ JSON เอง ค่าที่ตั้งจะถูกส่งไปที่รถผ่าน action เดิม และถูกนำไปใช้กับ throttle, steering, กับ step ของกล้อง
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyProfilePreset("gentle")}
                  className="rounded-full border border-white/50 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
                >
                  Gentle
                </button>
                <button
                  type="button"
                  onClick={() => applyProfilePreset("balanced")}
                  className="rounded-full border border-white/50 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
                >
                  Balanced
                </button>
                <button
                  type="button"
                  onClick={() => applyProfilePreset("sport")}
                  className="rounded-full border border-white/50 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
                >
                  Sport
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileDraft(DEFAULT_SOFT_CODE_PROFILE);
                    setProfileError("");
                  }}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Reset Draft
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Profile Name
                  </label>
                  <input
                    value={profileDraft.name}
                    onChange={(e) =>
                      setProfileDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full rounded-2xl border border-white/40 bg-white/72 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Note
                  </label>
                  <input
                    value={profileDraft.note}
                    onChange={(e) =>
                      setProfileDraft((prev) => ({ ...prev, note: e.target.value }))
                    }
                    className="w-full rounded-2xl border border-white/40 bg-white/72 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Drive Scale {profileDraft.driveScale.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0.3"
                    max="2"
                    step="0.01"
                    value={profileDraft.driveScale}
                    onChange={(e) =>
                      setProfileDraft((prev) => ({ ...prev, driveScale: Number(e.target.value) }))
                    }
                    className="w-full accent-slate-950"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Steering Scale {profileDraft.steeringScale.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0.3"
                    max="2"
                    step="0.01"
                    value={profileDraft.steeringScale}
                    onChange={(e) =>
                      setProfileDraft((prev) => ({ ...prev, steeringScale: Number(e.target.value) }))
                    }
                    className="w-full accent-slate-950"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Camera Step {profileDraft.cameraStepDeg.toFixed(0)} deg
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="12"
                    step="1"
                    value={profileDraft.cameraStepDeg}
                    onChange={(e) =>
                      setProfileDraft((prev) => ({ ...prev, cameraStepDeg: Number(e.target.value) }))
                    }
                    className="w-full accent-slate-950"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Throttle Exponent {profileDraft.throttleExponent.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2.5"
                    step="0.01"
                    value={profileDraft.throttleExponent}
                    onChange={(e) =>
                      setProfileDraft((prev) => ({ ...prev, throttleExponent: Number(e.target.value) }))
                    }
                    className="w-full accent-slate-950"
                  />
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Live Preview
                  </p>
                  <span className="rounded-full border border-white/70 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    Declarative soft code
                  </span>
                </div>
                <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p>Drive: {profileDraft.driveScale.toFixed(2)}x</p>
                  <p>Steering: {profileDraft.steeringScale.toFixed(2)}x</p>
                  <p>Camera Step: {profileDraft.cameraStepDeg} deg</p>
                  <p>Throttle Curve: {profileDraft.throttleExponent.toFixed(2)}</p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Applying..." : "Apply to Vehicle"}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    setProfileDraft(DEFAULT_SOFT_CODE_PROFILE);
                    setProfileError("");
                    await onResetSoftCodeProfile();
                    setMessage("Reset soft code profile to defaults");
                  }}
                  className="rounded-2xl border border-amber-200/70 bg-amber-400/15 px-4 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset to Defaults
                </button>
              </div>

              <div className="mt-2 text-xs text-rose-700">{profileError || ""}</div>
            </form>
          )}

          <div className="rounded-2xl glass-chip p-3 text-sm text-neutral-600">
            {message || "ยังไม่มีการส่งคำสั่ง settings"}
          </div>
        </div>

        {confirmAction && (
          <div
            className="absolute inset-0 z-10 flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:items-center"
            onClick={() => setConfirmAction(null)}
          >
            <section
              className="w-full max-w-md rounded-2xl border border-white/40 bg-white/88 p-4 shadow-xl backdrop-blur-xl sm:rounded-3xl sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-slate-900">{confirmAction.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{confirmAction.description}</p>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAndRunAction}
                  className="rounded-xl border border-rose-200/60 bg-rose-500/85 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
                >
                  Confirm
                </button>
              </div>
            </section>
          </div>
        )}

      </section>
    </div>
  );
}
