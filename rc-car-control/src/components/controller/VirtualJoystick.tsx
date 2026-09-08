"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "@/lib/math";
import { resolveDriveCommand } from "@/lib/driveInput";
import type { ControlCommand } from "@/types/control";

interface VirtualJoystickProps {
  onMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  size?: number;
  compact?: boolean;
}

type Point = { x: number; y: number };

const MOVE_SEND_INTERVAL_MS = 100;
const MOVE_HEARTBEAT_INTERVAL_MS = 250;

export default function VirtualJoystick({
  onMove,
  size = 220,
  compact = false,
}: VirtualJoystickProps) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMoveSentAtRef = useRef(0);
  const currentCommandRef = useRef<ControlCommand>("STOP");
  const currentPayloadRef = useRef<Record<string, unknown>>({
    throttle: 0,
    steering: 0,
  });
  const onMoveRef = useRef(onMove);

  const [stick, setStick] = useState<Point>({ x: 0, y: 0 });

  const radius = useMemo(() => size / 2, [size]);
  const knobSize = useMemo(() => size * 0.34, [size]);
  const maxDistance = useMemo(() => radius - knobSize / 2 - 8, [radius, knobSize]);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    return () => {
      if (repeatTimerRef.current) {
        clearInterval(repeatTimerRef.current);
      }
      if (pendingSendTimerRef.current) {
        clearTimeout(pendingSendTimerRef.current);
      }
      if (activeRef.current) {
        onMoveRef.current("STOP", { throttle: 0, steering: 0 });
      }
    };
  }, []);

  const sendCurrentMove = () => {
    const now = Date.now();
    const elapsed = now - lastMoveSentAtRef.current;

    if (elapsed >= MOVE_SEND_INTERVAL_MS) {
      lastMoveSentAtRef.current = now;
      onMoveRef.current(currentCommandRef.current, currentPayloadRef.current);
      return;
    }

    if (pendingSendTimerRef.current) return;
    pendingSendTimerRef.current = setTimeout(() => {
      pendingSendTimerRef.current = null;
      if (!activeRef.current) return;
      lastMoveSentAtRef.current = Date.now();
      onMoveRef.current(currentCommandRef.current, currentPayloadRef.current);
    }, MOVE_SEND_INTERVAL_MS - elapsed);
  };

  const resetStick = (pointerId?: number) => {
    if (!activeRef.current) return;
    if (
      pointerId !== undefined &&
      activePointerIdRef.current !== null &&
      pointerId !== activePointerIdRef.current
    ) {
      return;
    }

    activeRef.current = false;
    activePointerIdRef.current = null;
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    if (pendingSendTimerRef.current) {
      clearTimeout(pendingSendTimerRef.current);
      pendingSendTimerRef.current = null;
    }
    lastMoveSentAtRef.current = 0;
    currentCommandRef.current = "STOP";
    currentPayloadRef.current = { throttle: 0, steering: 0 };
    setStick({ x: 0, y: 0 });
    onMoveRef.current("STOP", { throttle: 0, steering: 0 });
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

    const steering = Number(clamp(dx / maxDistance, -1, 1).toFixed(3));
    const throttle = Number(clamp(-dy / maxDistance, -1, 1).toFixed(3));
    const command = resolveDriveCommand(throttle, steering);

    setStick({ x: dx, y: dy });
    currentCommandRef.current = command;
    currentPayloadRef.current = { throttle, steering };
    sendCurrentMove();

    if (!repeatTimerRef.current) {
      repeatTimerRef.current = setInterval(() => {
        if (!activeRef.current || currentCommandRef.current === "STOP") return;
        sendCurrentMove();
      }, MOVE_HEARTBEAT_INTERVAL_MS);
    }
  };

  const joystickCircle = (
    <div
      ref={baseRef}
      className="relative touch-none select-none rounded-full border border-slate-200 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.98),rgba(241,245,249,0.9))] shadow-inner"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        if (activePointerIdRef.current !== null) return;
        e.preventDefault();
        activeRef.current = true;
        activePointerIdRef.current = e.pointerId;
        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
        updateFromClientPoint(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!activeRef.current || activePointerIdRef.current !== e.pointerId) return;
        e.preventDefault();
        updateFromClientPoint(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => resetStick(e.pointerId)}
      onPointerCancel={(e) => resetStick(e.pointerId)}
      onLostPointerCapture={(e) => resetStick(e.pointerId)}
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
