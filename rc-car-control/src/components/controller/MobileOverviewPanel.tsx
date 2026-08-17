import {
  Activity,
  BookOpen,
  Camera,
  CarFront,
  Cloud,
  Crosshair,
  Gamepad2,
  Keyboard,
  Smartphone,
} from "lucide-react";

import {
  actionLabel,
  driveStateLabel,
  formatCameraAim,
  pressedKeysLabel,
  trackPowerFromCommand,
} from "@/components/controller/controlPanelDisplay";
import type { InputMode } from "@/types/control";

interface GuideItem {
  label: string;
  value: string;
  hint: string;
}

interface MobileOverviewPanelProps {
  connectionState: string;
  vehicleOnline: boolean;
  cameraOn: boolean;
  cameraOnline: boolean;
  battery: number;
  wifi: number;
  latency: number | null;
  cameraPan: number;
  cameraTilt: number;
  lastCommand: string;
  lastAction: string;
  actionPressed: boolean;
  inputMode: InputMode;
  guideItems: GuideItem[];
  alertMessage?: string;
  alertLevel?: "warn" | "info";
}

type ConnectionItemProps = {
  icon: typeof Cloud;
  label: string;
  state: string;
  active: boolean;
  waiting?: boolean;
};

function ConnectionItem({ icon: Icon, label, state, active, waiting = false }: ConnectionItemProps) {
  const tone = active
    ? "text-emerald-700"
    : waiting
    ? "text-amber-700"
    : "text-slate-500";

  return (
    <div className="min-w-0 px-2 py-2.5 text-center">
      <Icon className={`mx-auto ${tone}`} size={17} strokeWidth={2.2} />
      <p className="mt-1 text-[10px] font-bold text-slate-900">{label}</p>
      <p className={`truncate text-[9px] font-semibold ${tone}`}>{state}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-slate-950">{value}</p>
    </div>
  );
}

export default function MobileOverviewPanel({
  connectionState,
  vehicleOnline,
  cameraOn,
  cameraOnline,
  battery,
  wifi,
  latency,
  cameraPan,
  cameraTilt,
  lastCommand,
  lastAction,
  actionPressed,
  inputMode,
  guideItems,
  alertMessage,
  alertLevel = "info",
}: MobileOverviewPanelProps) {
  const cloudConnected = connectionState === "CONNECTED";
  const cloudConnecting = connectionState === "CONNECTING";
  const ready = cloudConnected && vehicleOnline;
  const trackPower = trackPowerFromCommand(lastCommand);
  const cameraAim = formatCameraAim(cameraPan, cameraTilt);
  const InputIcon = inputMode === "gamepad" ? Gamepad2 : inputMode === "touch" ? Smartphone : Keyboard;
  const inputLabel = inputMode === "gamepad" ? "Gamepad" : inputMode === "touch" ? "จอยสัมผัส" : "Keyboard";

  return (
    <section
      className="mobile-overview overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      aria-label="สรุปสถานะรถสำหรับมือถือและแท็บเล็ต"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase text-slate-500">Vehicle overview</p>
          <h2 className="truncate text-sm font-bold text-slate-950">สถานะพร้อมใช้งาน</h2>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 text-[10px] font-bold ${ready ? "text-emerald-700" : "text-amber-700"}`}>
          <span className={`h-2 w-2 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`} />
          {ready ? "พร้อมควบคุม" : "กำลังตรวจสอบ"}
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-200 bg-slate-50">
        <ConnectionItem
          icon={Cloud}
          label="Cloud"
          state={cloudConnected ? "เชื่อมแล้ว" : cloudConnecting ? "กำลังเชื่อม" : "ขาดการเชื่อมต่อ"}
          active={cloudConnected}
          waiting={cloudConnecting}
        />
        <ConnectionItem
          icon={CarFront}
          label="ESP32 รถ"
          state={vehicleOnline ? "ออนไลน์" : cloudConnected ? "กำลังรอ" : "ยังตรวจไม่ได้"}
          active={vehicleOnline}
          waiting={cloudConnected && !vehicleOnline}
        />
        <ConnectionItem
          icon={Camera}
          label="ESP32-CAM"
          state={cameraOnline ? (cameraOn ? "ออนไลน์ · เปิดภาพ" : "ออนไลน์ · ปิดภาพ") : cloudConnected ? "กำลังรอ" : "ยังตรวจไม่ได้"}
          active={cameraOnline}
          waiting={cloudConnected && !cameraOnline}
        />
      </div>

      {alertMessage && (
        <div className={`border-b px-3 py-2 text-[11px] font-semibold ${
          alertLevel === "warn"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-sky-200 bg-sky-50 text-sky-900"
        }`}>
          {alertMessage}
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 border-b border-slate-200 sm:grid-cols-4 sm:divide-y-0">
        <Metric label="แบตเตอรี่" value={vehicleOnline ? `${battery}%` : "—"} />
        <Metric label="Wi-Fi รถ" value={vehicleOnline && wifi < 0 ? `${wifi} dBm` : "—"} />
        <Metric label="Cloud ping" value={cloudConnected && latency != null ? `${latency} ms` : "—"} />
        <Metric label="อุปกรณ์ควบคุม" value={inputLabel} />
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200">
        <div className="min-w-0 p-3">
          <div className="flex items-center gap-1.5 text-slate-500">
            <InputIcon size={14} />
            <p className="text-[9px] font-bold uppercase">คำสั่งขับ</p>
          </div>
          <p className="mt-1 truncate text-sm font-bold text-slate-950">
            {driveStateLabel(trackPower.left, trackPower.right)}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            {pressedKeysLabel(lastCommand)} · {lastCommand === "STOP" ? "ไม่ได้กดทิศทาง" : "กำลังกดค้าง"}
          </p>
        </div>
        <div className="min-w-0 p-3">
          <div className="flex items-center gap-1.5 text-slate-500">
            <Crosshair size={14} />
            <p className="text-[9px] font-bold uppercase">ทิศกล้อง</p>
          </div>
          <p className="mt-1 truncate text-sm font-bold text-slate-950">{cameraAim.panLabel}</p>
          <p className="truncate text-[10px] text-slate-500">{cameraAim.tiltLabel}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-[10px]">
        <Activity className={actionPressed ? "text-sky-600" : "text-slate-400"} size={14} />
        <span className="font-semibold text-slate-500">คำสั่งล่าสุด</span>
        <span className={`ml-auto max-w-[55%] truncate font-bold ${actionPressed ? "text-sky-700" : "text-slate-800"}`}>
          {actionLabel(lastAction)}
        </span>
      </div>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-bold text-slate-800 [&::-webkit-details-marker]:hidden">
          <BookOpen size={15} className="text-slate-500" />
          คู่มือควบคุม
          <span className="ml-auto text-[10px] font-semibold text-slate-500 group-open:hidden">แตะเพื่อดู</span>
          <span className="ml-auto hidden text-[10px] font-semibold text-slate-500 group-open:inline">ซ่อน</span>
        </summary>
        <div className="border-t border-slate-200 px-3 py-2">
          {guideItems.map((item) => (
            <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-900">{item.label}</p>
                <p className="truncate text-[9px] text-slate-500">{item.hint}</p>
              </div>
              <kbd className="text-[10px] font-bold text-slate-700">{item.value}</kbd>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
