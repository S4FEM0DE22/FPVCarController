import { Activity, BatteryMedium, Wifi } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface TelemetryTrendStripProps {
  connectionState: string;
  vehicleOnline: boolean;
  latency: number | null;
  battery: number;
  wifi: number;
  latencySamples: number[];
  batterySamples: number[];
  wifiSamples: number[];
}

interface TrendItemProps {
  icon: LucideIcon;
  label: string;
  value: string;
  values: number[];
  stroke: string;
  tone: string;
}

function sparklinePath(values: number[], width: number, height: number) {
  if (!values.length) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = values.length <= 1 ? 0 : width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = index * step;
      const normalized = (value - min) / span;
      const y = height - normalized * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function TrendItem({ icon: Icon, label, value, values, stroke, tone }: TrendItemProps) {
  const recentValues = values.slice(-60);
  const path = sparklinePath(recentValues, 240, 54);

  return (
    <div className="min-w-0 px-3 py-3 first:pl-3 lg:border-l lg:border-slate-200 lg:first:border-l-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-slate-500">
            <Icon size={14} />
            <p className="text-[10px] font-bold uppercase">{label}</p>
          </div>
          <p className={`mt-1 text-base font-bold ${tone}`}>{value}</p>
        </div>
        <span className="shrink-0 text-[9px] font-medium text-slate-400">
          {recentValues.length}/60
        </span>
      </div>

      <svg
        viewBox="0 0 240 54"
        className="mt-2 h-14 w-full overflow-visible"
        role="img"
        aria-label={`แนวโน้ม ${label} 60 วินาทีล่าสุด`}
      >
        <line x1="0" y1="53" x2="240" y2="53" stroke="#e2e8f0" strokeWidth="1" />
        {path ? (
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <line
            x1="0"
            y1="27"
            x2="240"
            y2="27"
            stroke="#cbd5e1"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />
        )}
      </svg>
    </div>
  );
}

export default function TelemetryTrendStrip({
  connectionState,
  vehicleOnline,
  latency,
  battery,
  wifi,
  latencySamples,
  batterySamples,
  wifiSamples,
}: TelemetryTrendStripProps) {
  const cloudConnected = connectionState === "CONNECTED";

  return (
    <section
      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      aria-label="แนวโน้มสถานะรถ"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5">
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-500">Live trends</p>
          <h2 className="mt-0.5 text-sm font-bold text-slate-950">ความเสถียร 60 วินาทีล่าสุด</h2>
        </div>
        <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${
          cloudConnected
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}>
          {cloudConnected ? "กำลังเก็บข้อมูล" : "รอการเชื่อมต่อ"}
        </span>
      </div>

      <div className="grid divide-y divide-slate-200 lg:grid-cols-3 lg:divide-y-0">
        <TrendItem
          icon={Activity}
          label="Cloud Ping"
          value={cloudConnected && latency != null ? `${latency} ms` : "—"}
          values={latencySamples}
          stroke="#10b981"
          tone="text-emerald-700"
        />
        <TrendItem
          icon={BatteryMedium}
          label="Battery"
          value={vehicleOnline ? `${battery}%` : "—"}
          values={batterySamples}
          stroke="#0ea5e9"
          tone="text-sky-700"
        />
        <TrendItem
          icon={Wifi}
          label="Vehicle Wi-Fi"
          value={vehicleOnline && wifi < 0 ? `${wifi} dBm` : "—"}
          values={wifiSamples}
          stroke="#f59e0b"
          tone="text-amber-700"
        />
      </div>
    </section>
  );
}
