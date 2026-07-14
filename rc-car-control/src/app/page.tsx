import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(13,148,136,0.22),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.18),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0))]" />

      <section className="relative mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-6 py-10 lg:px-10">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] xl:items-center">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full border border-white/60 bg-white/75 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-600 shadow-sm backdrop-blur">
              FPV Car Command Center
            </p>

            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-6xl lg:text-7xl">
              Control the car like a live mission console.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              เว็บควบคุมรถ FPV ที่ออกแบบใหม่ให้ชัดขึ้น ดูสถานะง่ายขึ้น และแยกโซนการขับ, กล้อง, และ telemetry ให้พร้อมใช้งานทั้งมือถือและคอมพิวเตอร์
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/controller"
                className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                เปิดหน้าควบคุม
              </Link>
              <a
                href="#features"
                className="rounded-2xl border border-white/70 bg-white/70 px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
              >
                ดูจุดเด่น
              </a>
            </div>
          </div>

          <div className="grid gap-4 rounded-[2rem] border border-white/60 bg-white/75 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Live View</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">Realtime telemetry</p>
              <p className="mt-1 text-sm text-slate-600">จัดวางสถานะให้มองแล้วตัดสินใจได้ทันที</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Desktop</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">Dashboard layout</p>
                <p className="mt-1 text-sm text-slate-600">Camera, controls, and status in one view.</p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Mobile</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">Landscape ready</p>
                <p className="mt-1 text-sm text-slate-600">Touch controls stay reachable and large.</p>
              </div>
            </div>
          </div>
        </div>

        <div id="features" className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.5rem] border border-white/60 bg-white/70 p-5 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">01</p>
            <h2 className="mt-3 text-lg font-semibold text-slate-950">Clear control hierarchy</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              แยกสิ่งสำคัญออกจากกันชัดเจน: ขับรถ, ควบคุมกล้อง, และดูสถานะระบบ
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-white/60 bg-white/70 p-5 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">02</p>
            <h2 className="mt-3 text-lg font-semibold text-slate-950">Better live feedback</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              เห็น latency, battery, WiFi, และสถานะการเชื่อมต่อแบบอ่านง่ายขึ้น
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-white/60 bg-white/70 p-5 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">03</p>
            <h2 className="mt-3 text-lg font-semibold text-slate-950">Fast access to safety</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              ปุ่มหยุดฉุกเฉินและการเชื่อมต่อซ้ำอยู่ใกล้มือเวลาต้องการใช้จริง
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}