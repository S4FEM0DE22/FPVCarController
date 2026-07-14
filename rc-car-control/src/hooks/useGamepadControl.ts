"use client";

import { useEffect, useRef } from "react";
import { clamp } from "@/lib/math";
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
  return pads.find((pad) => pad?.connected) ?? null;
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
    let lastActionAt = 0;
    let lastMoveKey = "";
    let hadActiveInput = false;
    let hornPressed = false;
    let cameraResetPressed = false;

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

      if (pad) {
        const lx = clamp(pad.axes[0] || 0, -1, 1);
        const ly = clamp(pad.axes[1] || 0, -1, 1);
        const rx = clamp(pad.axes[2] || 0, -1, 1);
        const ry = clamp(pad.axes[3] || 0, -1, 1);
        const deadzone = 0.18;

        const steering = Math.abs(lx) < deadzone ? 0 : Number(lx.toFixed(3));
        const throttle = Math.abs(ly) < deadzone ? 0 : Number((-ly).toFixed(3));

        let command: ControlCommand = "STOP";
        if (throttle > 0 && steering < 0) command = "FORWARD_LEFT";
        else if (throttle > 0 && steering > 0) command = "FORWARD_RIGHT";
        else if (throttle < 0 && steering < 0) command = "BACKWARD_LEFT";
        else if (throttle < 0 && steering > 0) command = "BACKWARD_RIGHT";
        else if (throttle > 0) command = "FORWARD";
        else if (throttle < 0) command = "BACKWARD";
        else if (steering < 0) command = "LEFT";
        else if (steering > 0) command = "RIGHT";

        const isActive = throttle !== 0 || steering !== 0;
        const moveKey = `${command}:${throttle}:${steering}`;

        if (isActive) {
          hadActiveInput = true;
          if (moveKey !== lastMoveKey) {
            lastMoveKey = moveKey;
            onMoveRef.current(command, { throttle, steering });
          }
        } else if (hadActiveInput) {
          hadActiveInput = false;
          lastMoveKey = "STOP:0:0";
          onMoveRef.current("STOP", { throttle: 0, steering: 0 });
        }

        updateActionPress("HORN", Boolean(pad.buttons[0]?.pressed));
        updateActionPress("CAM_RESET", Boolean(pad.buttons[3]?.pressed));

        const now = Date.now();
        if (now - lastActionAt > 220) {
          const heldCameraAction = resolveHeldCameraAction(pad, rx, ry);

          if (pad.buttons[0]?.pressed) {
            onActionRef.current("HORN");
            lastActionAt = now;
          } else if (pad.buttons[1]?.pressed) {
            onActionRef.current("LIGHT_TOGGLE");
            lastActionAt = now;
          } else if (pad.buttons[2]?.pressed) {
            onActionRef.current("CAMERA_TOGGLE");
            lastActionAt = now;
          } else if (pad.buttons[3]?.pressed) {
            onActionRef.current("CAM_RESET");
            lastActionAt = now;
          } else if (pad.buttons[9]?.pressed) {
            hadActiveInput = false;
            lastMoveKey = "STOP:0:0";
            onMoveRef.current("STOP", { throttle: 0, steering: 0 });
            lastActionAt = now;
          } else if (heldCameraAction) {
            onActionRef.current(heldCameraAction.action, {
              amount: heldCameraAction.amount,
            });
            lastActionAt = now;
          }
        }
      } else if (hadActiveInput) {
        hadActiveInput = false;
        lastMoveKey = "STOP:0:0";
        updateActionPress("HORN", false);
        updateActionPress("CAM_RESET", false);
        onMoveRef.current("STOP", { throttle: 0, steering: 0 });
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
