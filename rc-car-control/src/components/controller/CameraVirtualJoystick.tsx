"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "@/lib/math";
import type { ActionCommand } from "@/types/control";

interface CameraVirtualJoystickProps {
  onAction: (
    action: Extract<ActionCommand, "CAM_UP" | "CAM_DOWN" | "CAM_LEFT" | "CAM_RIGHT">,
    payload?: Record<string, unknown>
  ) => void;
  size?: number;
  compact?: boolean;
}

type Point = { x: number; y: number };
type CameraStickAction = Extract<
  ActionCommand,
  "CAM_UP" | "CAM_DOWN" | "CAM_LEFT" | "CAM_RIGHT"
>;

function normalizedAmount(x: number, y: number, maxDistance: number) {
  const distance = Math.sqrt(x * x + y * y);
  return clamp(distance / maxDistance, 0, 1);
}

function resolveCameraAction(
  x: number,
  y: number,
  maxDistance: number
): "CENTER" | CameraStickAction {
  const deadzone = 0.22;
  const nx = x / maxDistance;
  const ny = y / maxDistance;

  if (Math.abs(nx) < deadzone && Math.abs(ny) < deadzone) return "CENTER";

  if (Math.abs(ny) >= Math.abs(nx)) {
    return ny < 0 ? "CAM_UP" : "CAM_DOWN";
  }

  return nx < 0 ? "CAM_LEFT" : "CAM_RIGHT";
}

export default function CameraVirtualJoystick({
  onAction,
  size = 220,
  compact = false,
}: CameraVirtualJoystickProps) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<Point>({ x: 0, y: 0 });
  const activeRef = useRef(false);
  const lastActionRef = useRef<"CENTER" | CameraStickAction>("CENTER");
  const holdActionRef = useRef<"CENTER" | CameraStickAction>("CENTER");
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [stick, setStick] = useState<Point>({ x: 0, y: 0 });

  const radius = useMemo(() => size / 2, [size]);
  const knobSize = useMemo(() => size * 0.34, [size]);
  const maxDistance = useMemo(() => radius - knobSize / 2 - 8, [radius, knobSize]);

  const resetStick = () => {
    activeRef.current = false;
    lastActionRef.current = "CENTER";
    holdActionRef.current = "CENTER";
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    stickRef.current = { x: 0, y: 0 };
    setStick({ x: 0, y: 0 });
  };

  const updateFromClientPoint = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;

    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    let dx = clientX - cx;
    let dy = clientY - cy;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxDistance) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * maxDistance;
      dy = Math.sin(angle) * maxDistance;
    }

    const limitedX = clamp(dx, -maxDistance, maxDistance);
    const limitedY = clamp(dy, -maxDistance, maxDistance);
    const action = resolveCameraAction(limitedX, limitedY, maxDistance);
    const amount = normalizedAmount(limitedX, limitedY, maxDistance);

    stickRef.current = { x: limitedX, y: limitedY };
    setStick({ x: limitedX, y: limitedY });
    holdActionRef.current = action;

    if (action !== "CENTER" && action !== lastActionRef.current) {
      lastActionRef.current = action;
      onAction(action, { amount });
    }

    if (action !== "CENTER" && !repeatTimerRef.current) {
      repeatTimerRef.current = setInterval(() => {
        if (holdActionRef.current !== "CENTER") {
          onAction(holdActionRef.current, {
            amount: normalizedAmount(stickRef.current.x, stickRef.current.y, maxDistance),
          });
        }
      }, 180);
    }

    if (action === "CENTER" && repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (repeatTimerRef.current) {
        clearInterval(repeatTimerRef.current);
      }
    };
  }, []);

  const joystickCircle = (
    <div
      ref={baseRef}
      className="relative touch-none select-none rounded-full border border-slate-200 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.98),rgba(241,245,249,0.9))] shadow-inner"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        activeRef.current = true;
        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
        updateFromClientPoint(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!activeRef.current) return;
        updateFromClientPoint(e.clientX, e.clientY);
      }}
      onPointerUp={resetStick}
      onPointerCancel={resetStick}
      onPointerLeave={() => {
        if (activeRef.current) resetStick();
      }}
    >
      <div className="absolute inset-1/2 h-0.5 w-[78%] -translate-x-1/2 -translate-y-1/2 bg-slate-300" />
      <div className="absolute inset-1/2 h-[78%] w-0.5 -translate-x-1/2 -translate-y-1/2 bg-slate-300" />

      <div
        className="absolute left-1/2 top-1/2 rounded-full border border-emerald-200 bg-emerald-100/90 shadow-[0_6px_18px_rgba(16,185,129,0.2)] backdrop-blur-sm transition-transform"
        style={{
          width: knobSize,
          height: knobSize,
          transform: `translate(calc(-50% + ${stick.x}px), calc(-50% + ${stick.y}px))`,
        }}
      />
    </div>
  );

  if (compact) return joystickCircle;

  return (
    <section className="rounded-3xl glass-surface desktop-glass-surface p-4 text-slate-900 transition-shadow duration-200 hover:shadow-md">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Camera Joystick</h2>
        <span className="rounded-2xl glass-chip desktop-glass-chip px-3 py-1 text-xs text-slate-500">
          Pan / Tilt
        </span>
      </div>

      <div className="flex flex-col items-center">
        {joystickCircle}
        <p className="mt-4 text-sm text-slate-500">ลากเพื่อหมุนกล้องตามทิศทาง</p>
      </div>
    </section>
  );
}