import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CarFront,
  Crosshair,
  Gamepad2,
  Lightbulb,
  Octagon,
  RotateCcw,
  Volume2,
} from "lucide-react";

import CameraVirtualJoystick from "@/components/controller/CameraVirtualJoystick";
import VirtualJoystick from "@/components/controller/VirtualJoystick";
import type { ActionCommand, ControlCommand, InputMode } from "@/types/control";

interface TouchControlDeckProps {
  inputMode: InputMode;
  cameraOn: boolean;
  lightOn: boolean;
  onMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  onAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
  onStop: () => void;
  sideBySide?: boolean;
  externalPressedQuickAction?: "horn" | "cameraReset" | null;
}

export default function TouchControlDeck({
  inputMode,
  cameraOn,
  lightOn,
  onMove,
  onAction,
  onStop,
  sideBySide = false,
  externalPressedQuickAction = null,
}: TouchControlDeckProps) {
  const [pressedAction, setPressedAction] = useState<"horn" | "cameraReset" | null>(null);
  const [deckWidth, setDeckWidth] = useState(0);
  const deckRef = useRef<HTMLElement | null>(null);
  const hornRepeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hornPointerActiveRef = useRef(false);
  const skipHornClickRef = useRef(false);
  const activeAction = pressedAction ?? externalPressedQuickAction;
  const showSticks = inputMode !== "gamepad";
  const availableJoystickWidth = Math.floor((deckWidth - 24 - 12) / 2 - 16);
  const joystickMaxSize = sideBySide ? 136 : deckWidth >= 600 ? 156 : 124;
  const joystickSize = deckWidth
    ? Math.max(sideBySide ? 76 : 96, Math.min(joystickMaxSize, availableJoystickWidth))
    : sideBySide
    ? 104
    : 124;
  const actionButtonHeightClass = sideBySide ? "min-h-10" : "min-h-11";

  const stopHornHold = () => {
    if (hornRepeatTimerRef.current) {
      clearInterval(hornRepeatTimerRef.current);
      hornRepeatTimerRef.current = null;
    }
    hornPointerActiveRef.current = false;
    setPressedAction((current) => (current === "horn" ? null : current));
  };

  const startHornHold = () => {
    if (hornPointerActiveRef.current) return;
    hornPointerActiveRef.current = true;
    skipHornClickRef.current = true;
    setPressedAction("horn");
    onAction("HORN");
    hornRepeatTimerRef.current = setInterval(() => {
      if (hornPointerActiveRef.current) onAction("HORN");
    }, 220);
  };

  const cancelHornHold = () => {
    stopHornHold();
    skipHornClickRef.current = false;
  };

  useEffect(() => {
    return () => {
      if (hornRepeatTimerRef.current) {
        clearInterval(hornRepeatTimerRef.current);
        hornRepeatTimerRef.current = null;
      }
      hornPointerActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;

    const updateWidth = () => setDeckWidth(deck.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(deck);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={deckRef}
      className={`touch-control-deck flex h-full flex-col rounded-lg border border-slate-200 bg-white shadow-sm ${
        sideBySide ? "p-2" : "p-3"
      }`}
      aria-label="แผงควบคุมแบบสัมผัส"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-500">Control deck</p>
          <h2 className="mt-0.5 text-sm font-bold text-slate-950">
            {showSticks ? "จอยเสมือน" : "กำลังใช้ Gamepad"}
          </h2>
        </div>
        {inputMode === "gamepad" && (
          <span className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800">
            <Gamepad2 size={13} /> เชื่อมต่อแล้ว
          </span>
        )}
      </div>

      {showSticks && (
        <div className={`grid flex-1 grid-cols-2 items-center ${sideBySide ? "mt-2" : "mt-3"}`}>
          <div className={`grid min-w-0 place-items-center border-r border-slate-200 ${sideBySide ? "pr-1.5" : "pr-2"}`}>
            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-slate-500"><CarFront size={12} /> ขับรถ</p>
            <VirtualJoystick onMove={onMove} size={joystickSize} compact />
          </div>
          <div className={`grid min-w-0 place-items-center ${sideBySide ? "pl-1.5" : "pl-2"}`}>
            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-slate-500"><Crosshair size={12} /> หันกล้อง</p>
            <CameraVirtualJoystick onAction={onAction} size={joystickSize} compact />
          </div>
        </div>
      )}

      {!showSticks && (
        <div className="grid flex-1 place-items-center py-3 text-center">
          <div>
            <Gamepad2 className="mx-auto text-emerald-600" size={30} />
            <p className="mt-1.5 text-xs font-bold text-slate-900">พร้อมรับคำสั่งจากจอย</p>
            <p className="mt-0.5 text-[10px] text-slate-500">จอยเสมือนถูกซ่อนอัตโนมัติ</p>
          </div>
        </div>
      )}

      <div className={`touch-control-actions gap-1.5 border-t border-slate-200 pt-2 ${sideBySide ? "mt-2" : "mt-3"}`}>
        <button
          type="button"
          onClick={() => onAction("LIGHT_TOGGLE")}
          className={`grid ${actionButtonHeightClass} place-items-center rounded-md border text-[8px] font-bold transition active:scale-95 ${
            lightOn ? "border-amber-300 bg-amber-400 text-slate-950" : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
          title="เปิดหรือปิดไฟ"
        >
          <Lightbulb size={16} />
          ไฟ
        </button>
        <button
          type="button"
          onClick={() => onAction("CAM_RESET")}
          onPointerDown={() => setPressedAction("cameraReset")}
          onPointerUp={() => setPressedAction(null)}
          onPointerCancel={() => setPressedAction(null)}
          onPointerLeave={() => setPressedAction(null)}
          className={`grid ${actionButtonHeightClass} place-items-center rounded-md border text-[8px] font-bold transition active:scale-95 ${
            activeAction === "cameraReset"
              ? "border-sky-300 bg-sky-500 text-white"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
          title="ตั้งกล้องกลับกึ่งกลาง"
        >
          <RotateCcw size={16} />
          กลาง
        </button>
        <button
          type="button"
          onClick={() => onAction("CAMERA_TOGGLE")}
          className={`grid ${actionButtonHeightClass} place-items-center rounded-md border text-[8px] font-bold transition active:scale-95 ${
            cameraOn ? "border-emerald-300 bg-emerald-500 text-white" : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
          title="เปิดหรือปิดกล้อง"
        >
          <Camera size={16} />
          กล้อง
        </button>
        <button
          type="button"
          onClick={() => {
            if (skipHornClickRef.current) {
              skipHornClickRef.current = false;
              return;
            }
            onAction("HORN");
          }}
          onPointerDown={startHornHold}
          onPointerUp={stopHornHold}
          onPointerCancel={cancelHornHold}
          onPointerLeave={() => {
            if (hornPointerActiveRef.current) cancelHornHold();
          }}
          className={`grid ${actionButtonHeightClass} place-items-center rounded-md border text-[8px] font-bold transition active:scale-95 ${
            activeAction === "horn"
              ? "border-orange-300 bg-orange-500 text-white"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
          title="แตร"
        >
          <Volume2 size={16} />
          แตร
        </button>
        <button
          type="button"
          onClick={onStop}
          className={`touch-stop-button grid ${actionButtonHeightClass} place-items-center rounded-md border border-rose-600 bg-rose-600 text-[8px] font-bold text-white shadow-sm transition active:scale-95`}
          title="หยุดรถทันที"
        >
          <Octagon size={17} />
          STOP
        </button>
      </div>
    </section>
  );
}
