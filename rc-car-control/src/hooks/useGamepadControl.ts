"use client";

import { useEffect, useRef } from "react";
import { clamp } from "@/lib/math";
import { normalizeDriveInput, resolveDriveCommand } from "@/lib/driveInput";
import type { ActionCommand, ControlCommand } from "@/types/control";

interface GamepadControlProps {
  enabled: boolean;
  onMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  onAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
  onActionPressChange?: (
    action: Extract<ActionCommand, "HORN" | "CAM_RESET">,
    pressed: boolean
  ) => void;
}

function findConnectedGamepad() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  const pads = Array.from(navigator.getGamepads());
  return (
    pads.find((pad) => pad?.connected && pad.mapping === "standard") ??
    pads.find((pad) => pad?.connected) ??
    null
  );
}

const GAMEPAD_DEADZONE = 0.14;
const GAMEPAD_AXIS_SNAP_RATIO = 0.32;
const GAMEPAD_AXIS_RELEASE_RATIO = 0.45;
const GAMEPAD_OUTPUT_STEP = 0.05;
const GAMEPAD_STEP_HYSTERESIS = 0.01;
const MOVE_SEND_INTERVAL_MS = 100;
const MOVE_HEARTBEAT_INTERVAL_MS = 250;

function stabilizeDriveAxis(value: number, previous: number | null) {
  if (
    previous !== null &&
    Math.abs(value - previous) < GAMEPAD_OUTPUT_STEP / 2 + GAMEPAD_STEP_HYSTERESIS
  ) {
    return previous;
  }
  return Number((Math.round(value / GAMEPAD_OUTPUT_STEP) * GAMEPAD_OUTPUT_STEP).toFixed(2));
}

function resolveCameraAction(
  rx: number,
  ry: number
): Extract<ActionCommand, "CAM_UP" | "CAM_DOWN" | "CAM_LEFT" | "CAM_RIGHT"> | null {
  const deadzone = 0.35;

  if (Math.abs(rx) < deadzone && Math.abs(ry) < deadzone) {
    return null;
  }

  if (Math.abs(ry) >= Math.abs(rx)) {
    return ry < 0 ? "CAM_UP" : "CAM_DOWN";
  }

  return rx < 0 ? "CAM_LEFT" : "CAM_RIGHT";
}

function resolveHeldCameraAction(
  pad: Gamepad,
  rx: number,
  ry: number
): {
  action: Extract<ActionCommand, "CAM_UP" | "CAM_DOWN" | "CAM_LEFT" | "CAM_RIGHT">;
  amount: number;
} | null {
  if (pad.buttons[12]?.pressed) return { action: "CAM_UP", amount: 1 };
  if (pad.buttons[13]?.pressed) return { action: "CAM_DOWN", amount: 1 };
  if (pad.buttons[14]?.pressed) return { action: "CAM_LEFT", amount: 1 };
  if (pad.buttons[15]?.pressed) return { action: "CAM_RIGHT", amount: 1 };

  const action = resolveCameraAction(rx, ry);
  if (!action) return null;

  return {
    action,
    amount: Math.max(Math.abs(rx), Math.abs(ry)),
  };
}

export default function useGamepadControl({
  enabled,
  onMove,
  onAction,
  onActionPressChange,
}: GamepadControlProps) {
  const wasEnabledRef = useRef(enabled);
  const onMoveRef = useRef(onMove);
  const onActionRef = useRef(onAction);
  const onActionPressChangeRef = useRef(onActionPressChange);

  useEffect(() => {
    onMoveRef.current = onMove;
    onActionRef.current = onAction;
    onActionPressChangeRef.current = onActionPressChange;
  }, [onMove, onAction, onActionPressChange]);

  useEffect(() => {
    if (wasEnabledRef.current && !enabled) {
      onMoveRef.current("STOP", { throttle: 0, steering: 0 });
    }

    wasEnabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let rafId = 0;
    let lastHeldActionAt = 0;
    let lastMoveSentAt = 0;
    let lastMove: { command: ControlCommand; throttle: number; steering: number } | null = null;
    let hadActiveInput = false;
    let stopLatched = false;
    let hornPressed = false;
    let cameraResetPressed = false;
    let lightButtonWasPressed = false;
    let cameraToggleWasPressed = false;
    let cameraResetButtonWasPressed = false;
    let stopButtonWasPressed = false;

    const updateActionPress = (
      action: Extract<ActionCommand, "HORN" | "CAM_RESET">,
      nextPressed: boolean
    ) => {
      if (action === "HORN") {
        if (hornPressed === nextPressed) return;
        hornPressed = nextPressed;
      } else {
        if (cameraResetPressed === nextPressed) return;
        cameraResetPressed = nextPressed;
      }

      onActionPressChangeRef.current?.(action, nextPressed);
    };

    const loop = () => {
      const pad = findConnectedGamepad();
      const now = Date.now();

      if (pad) {
        const lx = clamp(pad.axes[0] || 0, -1, 1);
        const ly = clamp(pad.axes[1] || 0, -1, 1);
        const rx = clamp(pad.axes[2] || 0, -1, 1);
        const ry = clamp(pad.axes[3] || 0, -1, 1);
        const wasHorizontal = lastMove?.command === "LEFT" || lastMove?.command === "RIGHT";
        const wasVertical = lastMove?.command === "FORWARD" || lastMove?.command === "BACKWARD";
        const horizontalSnap = Math.abs(lx) > GAMEPAD_DEADZONE &&
          (Math.abs(ly) < GAMEPAD_DEADZONE ||
            Math.abs(ly) <= Math.abs(lx) * (wasHorizontal ? GAMEPAD_AXIS_RELEASE_RATIO : GAMEPAD_AXIS_SNAP_RATIO));
        const verticalSnap = Math.abs(ly) > GAMEPAD_DEADZONE &&
          (Math.abs(lx) < GAMEPAD_DEADZONE ||
            Math.abs(lx) <= Math.abs(ly) * (wasVertical ? GAMEPAD_AXIS_RELEASE_RATIO : GAMEPAD_AXIS_SNAP_RATIO));
        const normalized = normalizeDriveInput(horizontalSnap ? 0 : -ly, verticalSnap ? 0 : lx, {
          deadzone: GAMEPAD_DEADZONE,
        });
        const throttle = normalized.command === "STOP"
          ? 0
          : stabilizeDriveAxis(normalized.throttle, lastMove?.throttle ?? null);
        const steering = normalized.command === "STOP"
          ? 0
          : stabilizeDriveAxis(normalized.steering, lastMove?.steering ?? null);
        const command = resolveDriveCommand(throttle, steering);

        const isActive = throttle !== 0 || steering !== 0;
        const stopButtonPressed = Boolean(pad.buttons[9]?.pressed);

        if (stopButtonPressed && !stopButtonWasPressed) {
          stopLatched = true;
          hadActiveInput = false;
          lastMove = null;
          lastMoveSentAt = 0;
          onMoveRef.current("STOP", { throttle: 0, steering: 0 });
        }
        if (stopLatched && !stopButtonPressed && !isActive) stopLatched = false;

        if (!stopLatched && isActive) {
          hadActiveInput = true;
          const valueChanged = !lastMove || command !== lastMove.command ||
            throttle !== lastMove.throttle || steering !== lastMove.steering;
          const sendInterval = valueChanged
            ? MOVE_SEND_INTERVAL_MS
            : MOVE_HEARTBEAT_INTERVAL_MS;
          if (now - lastMoveSentAt >= sendInterval) {
            lastMove = { command, throttle, steering };
            lastMoveSentAt = now;
            onMoveRef.current(command, { throttle, steering });
          }
        } else if (hadActiveInput) {
          hadActiveInput = false;
          lastMove = null;
          lastMoveSentAt = 0;
          onMoveRef.current("STOP", { throttle: 0, steering: 0 });
        }

        updateActionPress("HORN", Boolean(pad.buttons[0]?.pressed));
        updateActionPress("CAM_RESET", Boolean(pad.buttons[3]?.pressed));

        const lightButtonPressed = Boolean(pad.buttons[1]?.pressed);
        const cameraTogglePressed = Boolean(pad.buttons[2]?.pressed);
        const cameraResetButtonPressed = Boolean(pad.buttons[3]?.pressed);
        // Toggles and reset are edge-triggered so holding a gamepad button
        // cannot flip the state repeatedly.
        if (lightButtonPressed && !lightButtonWasPressed) {
          onActionRef.current("LIGHT_TOGGLE");
        }
        if (cameraTogglePressed && !cameraToggleWasPressed) {
          onActionRef.current("CAMERA_TOGGLE");
        }
        if (
          cameraResetButtonPressed &&
          !cameraResetButtonWasPressed
        ) {
          onActionRef.current("CAM_RESET");
          lastHeldActionAt = now;
        }
        if (now - lastHeldActionAt >= 220) {
          const heldCameraAction = resolveHeldCameraAction(pad, rx, ry);

          if (pad.buttons[0]?.pressed) {
            onActionRef.current("HORN");
            lastHeldActionAt = now;
          } else if (heldCameraAction) {
            onActionRef.current(heldCameraAction.action, {
              amount: heldCameraAction.amount,
            });
            lastHeldActionAt = now;
          }
        }

        lightButtonWasPressed = lightButtonPressed;
        cameraToggleWasPressed = cameraTogglePressed;
        cameraResetButtonWasPressed = cameraResetButtonPressed;
        stopButtonWasPressed = stopButtonPressed;
      } else {
        stopLatched = false;
        updateActionPress("HORN", false);
        updateActionPress("CAM_RESET", false);
        lightButtonWasPressed = false;
        cameraToggleWasPressed = false;
        cameraResetButtonWasPressed = false;
        stopButtonWasPressed = false;
        if (hadActiveInput) {
          hadActiveInput = false;
          lastMove = null;
          lastMoveSentAt = 0;
          onMoveRef.current("STOP", { throttle: 0, steering: 0 });
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      updateActionPress("HORN", false);
      updateActionPress("CAM_RESET", false);
    };
  }, [enabled]);
}
