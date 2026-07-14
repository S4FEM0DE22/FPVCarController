"use client";

import { useMemo, useRef, useState } from "react";
import { clamp } from "@/lib/math";
import type { ControlCommand } from "@/types/control";

interface VirtualJoystickProps {
  onMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  size?: number;
  compact?: boolean;
}

type Point = { x: number; y: number };

function round3(value: number) {
  return Number(value.toFixed(3));
}

export default function VirtualJoystick({
  onMove,
  size = 220,
  compact = false,
}: VirtualJoystickProps) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);

  const [stick, setStick] = useState<Point>({ x: 0, y: 0 });

  const radius = useMemo(() => size / 2, [size]);
  const knobSize = useMemo(() => size * 0.34, [size]);
  const maxDistance = useMemo(() => radius - knobSize / 2 - 8, [radius, knobSize]);

  const resetStick = () => {
    activeRef.current = false;
    setStick({ x: 0, y: 0 });
    onMove("STOP", { throttle: 0, steering: 0 });
  };

  const resolveCommand = (x: number, y: number): ControlCommand => {
    const deadzone = 0.22;

    const nx = x / maxDistance;
    const ny = y / maxDistance;

    const ax = Math.abs(nx);
    const ay = Math.abs(ny);

    if (ax < deadzone && ay < deadzone) return "STOP";

    const left = nx < -deadzone;
    const right = nx > deadzone;
    const up = ny < -deadzone;
    const down = ny > deadzone;

    if (up && left) return "FORWARD_LEFT";
    if (up && right) return "FORWARD_RIGHT";
    if (down && left) return "BACKWARD_LEFT";
    if (down && right) return "BACKWARD_RIGHT";
    if (up) return "FORWARD";
    if (down) return "BACKWARD";
    if (left) return "LEFT";
    if (right) return "RIGHT";

    return "STOP";
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

    const steering = round3(clamp(dx / maxDistance, -1, 1));
    const throttle = round3(clamp(-dy / maxDistance, -1, 1));

    setStick({ x: dx, y: dy });
    onMove(resolveCommand(dx, dy), { throttle, steering });
  };

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
        className="absolute left-1/2 top-1/2 rounded-full border border-sky-200 bg-sky-100/90 shadow-[0_6px_18px_rgba(56,189,248,0.22)] backdrop-blur-sm transition-transform"
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
        <h2 className="text-lg font-semibold">Virtual Joystick</h2>
        <span className="rounded-2xl glass-chip desktop-glass-chip px-3 py-1 text-xs text-slate-500">
          Touch Drive
        </span>
      </div>

      <div className="flex flex-col items-center">
        {joystickCircle}
        <p className="mt-4 text-sm text-slate-500">
          ลากเพื่อบังคับทิศทาง ปล่อยเพื่อหยุด
        </p>
      </div>
    </section>
  );
}