import {
  Activity,
  BatteryMedium,
  Camera,
  CarFront,
  Cloud,
  Crosshair,
  Gamepad2,
  Keyboard,
  Radio,
  Smartphone,
  Wifi,
} from "lucide-react";

import {
  actionLabel,
  driveStateLabel,
  formatCameraAim,
  pressedKeysLabel,
  trackPowerFromDrive,
  trackPowerFromCommand,
} from "@/components/controller/controlPanelDisplay";
import type { InputMode } from "@/types/control";

interface GuideItem {
  label: string;
  value: string;
  hint: string;
}

interface OperatorStatusPanelProps {
  connectionState: string;
  vehicleOnline: boolean;
  vehicleState: string;
  cameraOn: boolean;
  cameraOnline: boolean;
  battery: number;
  wifi: number;
  latency: number | null;
  profileName: string;
  cameraPan: number;
  cameraTilt: number;
  lastCommand: string;
  driveThrottle?: number;
  driveSteering?: number;
  lastAction: string;
  actionPressed: boolean;
  inputMode: InputMode;
  guideItems: GuideItem[];
  alertMessage?: string;
  alertLevel?: "warn" | "info";
}

type StatusTone = "good" | "waiting" | "bad" | "neutral";

const statusToneClass: Record<StatusTone, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-800",
  waiting: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-rose-200 bg-rose-50 text-rose-800",
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
};

function SystemRow({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Cloud;
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}) {
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-200/80 py-2.5 last:border-b-0">
      <span className={`grid h-8 w-8 place-items-center rounded-md border ${statusToneClass[tone]}`}>
        <Icon size={16} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-900">{label}</p>
        <p className="truncate text-[11px] text-slate-500">{detail}</p>
      </div>
      <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${statusToneClass[tone]}`}>
        {value}
      </span>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Cloud;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon size={14} />
        <span className="text-[10px] font-semibold uppercase">{label}</span>
      </div>
      <p className="mt-1 truncate text-base font-bold text-slate-950">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-slate-500">{hint}</p>
    </div>
  );
}

function TrackCommand({ label, value }: { label: string; value: number }) {
  const width = Math.abs(value) / 2;
  const command = value === 0 ? "หยุด" : value > 0 ? `เดินหน้า ${value}%` : `ถอยหลัง ${Math.abs(value)}%`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900">{command}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-sm bg-slate-200">
        <span className="absolute inset-y-0 left-1/2 w-px bg-slate-400" />
        {value !== 0 && (
          <span
            className={`absolute inset-y-0 ${value > 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-sky-500"}`}
            style={{ width: `${width}%` }}
          />
        )}
      </div>
    </div>
  );
}

export default function OperatorStatusPanel({
  connectionState,
  vehicleOnline,
  vehicleState,
  cameraOn,
  cameraOnline,
  battery,
  wifi,
  latency,
  profileName,
  cameraPan,
  cameraTilt,
  lastCommand,
  driveThrottle,
  driveSteering,
  lastAction,
  actionPressed,
  inputMode,
  guideItems,
  alertMessage,
  alertLevel = "info",
}: OperatorStatusPanelProps) {
  const cloudConnected = connectionState === "CONNECTED";
  const cloudConnecting = connectionState === "CONNECTING";
  const cloudTone: StatusTone = cloudConnected ? "good" : cloudConnecting ? "waiting" : "bad";
  const vehicleTone: StatusTone = vehicleOnline ? "good" : cloudConnected ? "waiting" : "neutral";
  const cameraTone: StatusTone = cameraOnline ? "good" : cloudConnected ? "waiting" : "neutral";
  const trackPower =
    typeof driveThrottle === "number" && typeof driveSteering === "number"
      ? trackPowerFromDrive(driveThrottle, driveSteering)
      : trackPowerFromCommand(lastCommand);
  const cameraAim = formatCameraAim(cameraPan, cameraTilt);
  const InputIcon = inputMode === "gamepad" ? Gamepad2 : inputMode === "touch" ? Smartphone : Keyboard;

  return (
    <div className="grid content-start gap-3" aria-label="สถานะรถและคู่มือควบคุม">
      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-500">System readiness</p>
            <h2 className="mt-0.5 text-sm font-bold text-slate-950">ความพร้อมของระบบ</h2>
          </div>
          <span className="text-[10px] font-medium text-slate-500">เรียงตามเส้นทางเชื่อมต่อ</span>
        </div>

        <div className="mt-2">
          <SystemRow
            icon={Cloud}
            label="เว็บไป Cloud"
            value={cloudConnected ? "เชื่อมแล้ว" : cloudConnecting ? "กำลังเชื่อม" : "ขาดการเชื่อมต่อ"}
            detail="WebSocket ระหว่างอุปกรณ์นี้กับเซิร์ฟเวอร์"
            tone={cloudTone}
          />
          <SystemRow
            icon={CarFront}
            label="รถ ESP32"
            value={vehicleOnline ? (vehicleState === "moving" ? "กำลังเคลื่อนที่" : "พร้อมควบคุม") : cloudConnected ? "รอรถ" : "ยังตรวจไม่ได้"}
            detail="สถานะ telemetry ล่าสุดจากรถ"
            tone={vehicleTone}
          />
          <SystemRow
            icon={Camera}
            label="ESP32-CAM"
            value={cameraOnline ? "เชื่อม Cloud แล้ว" : cloudConnected ? "รอกล้อง" : "ยังตรวจไม่ได้"}
            detail={`การเชื่อมต่อของบอร์ดกล้อง · คำสั่งกล้อง ${cameraOn ? "เปิด" : "ปิด"}`}
            tone={cameraTone}
          />
        </div>
      </section>

      {alertMessage && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
          alertLevel === "warn"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-sky-200 bg-sky-50 text-sky-900"
        }`}>
          {alertMessage}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <Metric
            icon={BatteryMedium}
            label="Battery"
            value={vehicleOnline ? `${battery}%` : "—"}
            hint="แบตเตอรี่รถ"
          />
          <Metric
            icon={Wifi}
            label="Vehicle Wi-Fi"
            value={vehicleOnline && wifi < 0 ? `${wifi} dBm` : "—"}
            hint="สัญญาณที่ ESP32 รับ"
          />
          <Metric
            icon={Activity}
            label="Cloud Ping"
            value={cloudConnected && latency != null ? `${latency} ms` : "—"}
            hint="เว็บถึงเซิร์ฟเวอร์"
          />
          <Metric
            icon={Radio}
            label="Drive Profile"
            value={profileName || "—"}
            hint="โปรไฟล์จูนปัจจุบัน"
          />
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="flex items-start gap-2">
            <Crosshair className="mt-0.5 text-slate-500" size={15} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Camera direction</p>
              <p className="mt-1 text-sm font-bold text-slate-950">{cameraAim.compact}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Pan ตรง = 0° · Tilt ก้มสุด = 0° · Servo {cameraAim.panServoDeg}°/{cameraAim.tiltServoDeg}°
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-500">Command monitor</p>
            <h2 className="mt-0.5 text-sm font-bold text-slate-950">คำสั่งที่กำลังส่ง</h2>
          </div>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700">
            {driveStateLabel(trackPower.left, trackPower.right)}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">เป็นค่าคำสั่งจากเว็บ ไม่ใช่เซนเซอร์วัดรอบมอเตอร์จริง</p>

        <div className="mt-3 space-y-2.5">
          <TrackCommand label="ล้อซ้าย" value={trackPower.left} />
          <TrackCommand label="ล้อขวา" value={trackPower.right} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-center gap-1.5 text-slate-500">
              <InputIcon size={14} />
              <span className="text-[10px] font-semibold uppercase">Input</span>
            </div>
            <p className="mt-1 font-bold text-slate-950">{pressedKeysLabel(lastCommand)}</p>
            <p className="text-[10px] text-slate-500">{lastCommand === "STOP" ? "ไม่ได้กดทิศทาง" : "กำลังกดค้าง"}</p>
          </div>
          <div className={`rounded-lg border p-2 ${actionPressed ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex items-center gap-1.5 text-slate-500">
              <Activity size={14} />
              <span className="text-[10px] font-semibold uppercase">Action</span>
            </div>
            <p className="mt-1 truncate font-bold text-slate-950">{actionLabel(lastAction)}</p>
            <p className="text-[10px] text-slate-500">{actionPressed ? "เพิ่งกดคำสั่ง" : "ว่าง"}</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-950">คู่มือควบคุม</h2>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">
            {inputMode}
          </span>
        </div>
        <div className="mt-2 grid gap-1.5">
          {guideItems.map((item) => (
            <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900">{item.label}</p>
                <p className="truncate text-[10px] text-slate-500">{item.hint}</p>
              </div>
              <kbd className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700">
                {item.value}
              </kbd>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
