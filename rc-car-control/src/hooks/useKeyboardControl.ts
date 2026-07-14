"use client";

import { useEffect, useRef } from "react";
import type { ActionCommand, ControlCommand } from "@/types/control";

interface KeyboardControlProps {
  enabled: boolean;
  onMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  onAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
  onActionPressChange?: (
    action: Extract<ActionCommand, "HORN" | "CAM_RESET">,
    pressed: boolean
  ) => void;
}

export default function useKeyboardControl({
  enabled,
  onMove,
  onAction,
  onActionPressChange,
}: KeyboardControlProps) {
  const pressedRef = useRef<Set<string>>(new Set());
  const heldCameraKeysRef = useRef<Set<string>>(new Set());
  const lastKeyRef = useRef<string>("");
  const onMoveRef = useRef(onMove);
  const onActionRef = useRef(onAction);
  const onActionPressChangeRef = useRef(onActionPressChange);

  const cameraActionFromKey = (code: string): Extract<ActionCommand, "CAM_UP" | "CAM_DOWN" | "CAM_LEFT" | "CAM_RIGHT"> | null => {
    if (code === "ArrowUp") return "CAM_UP";
    if (code === "ArrowDown") return "CAM_DOWN";
    if (code === "ArrowLeft") return "CAM_LEFT";
    if (code === "ArrowRight") return "CAM_RIGHT";
    return null;
  };

  const resolveHeldCameraAction = (heldCameraKeys: Set<string>): Extract<ActionCommand, "CAM_UP" | "CAM_DOWN" | "CAM_LEFT" | "CAM_RIGHT"> | null => {
    if (heldCameraKeys.has("ArrowUp")) return "CAM_UP";
    if (heldCameraKeys.has("ArrowDown")) return "CAM_DOWN";
    if (heldCameraKeys.has("ArrowLeft")) return "CAM_LEFT";
    if (heldCameraKeys.has("ArrowRight")) return "CAM_RIGHT";
    return null;
  };

  useEffect(() => {
    onMoveRef.current = onMove;
    onActionRef.current = onAction;
    onActionPressChangeRef.current = onActionPressChange;
  }, [onMove, onAction, onActionPressChange]);

  useEffect(() => {
    if (!enabled) return;

    const pressed = pressedRef.current;
    const heldCameraKeys = heldCameraKeysRef.current;
    let cameraRepeatTimer: ReturnType<typeof setInterval> | null = null;

    const stopCameraRepeat = () => {
      if (cameraRepeatTimer) {
        clearInterval(cameraRepeatTimer);
        cameraRepeatTimer = null;
      }
    };

    const startCameraRepeat = () => {
      if (cameraRepeatTimer) return;

      cameraRepeatTimer = setInterval(() => {
        const action = resolveHeldCameraAction(heldCameraKeys);
        if (!action) {
          stopCameraRepeat();
          return;
        }

        onActionRef.current(action, { amount: 1 });
      }, 180);
    };

    const computeMove = () => {
      let throttle = 0;
      let steering = 0;

      if (pressed.has("KeyW")) throttle += 1;
      if (pressed.has("KeyS")) throttle -= 1;
      if (pressed.has("KeyD")) steering += 1;
      if (pressed.has("KeyA")) steering -= 1;

      let command: ControlCommand = "STOP";

      if (throttle > 0 && steering === 0) command = "FORWARD";
      else if (throttle < 0 && steering === 0) command = "BACKWARD";
      else if (throttle === 0 && steering < 0) command = "LEFT";
      else if (throttle === 0 && steering > 0) command = "RIGHT";
      else if (throttle > 0 && steering < 0) command = "FORWARD_LEFT";
      else if (throttle > 0 && steering > 0) command = "FORWARD_RIGHT";
      else if (throttle < 0 && steering < 0) command = "BACKWARD_LEFT";
      else if (throttle < 0 && steering > 0) command = "BACKWARD_RIGHT";

      const key = `${command}:${throttle}:${steering}`;

      if (key === lastKeyRef.current) return;

      lastKeyRef.current = key;

      onMoveRef.current(command, {
        throttle,
        steering,
      });
    };

    const clearAll = () => {
      pressed.clear();
      heldCameraKeys.clear();
      stopCameraRepeat();
      lastKeyRef.current = "";
      onActionPressChangeRef.current?.("HORN", false);
      onActionPressChangeRef.current?.("CAM_RESET", false);
      onMoveRef.current("STOP", { throttle: 0, steering: 0 });
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearAll();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const moveKeys = ["KeyW", "KeyA", "KeyS", "KeyD"];
      const actionKeys = [
        "Escape",
        "KeyH",
        "KeyL",
        "KeyR",
        "KeyX",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ];

      if (!moveKeys.includes(e.code) && !actionKeys.includes(e.code)) return;

      const target = e.target;
      const element = target instanceof HTMLElement ? target : null;
      const tag = element?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        element?.isContentEditable;

      if (isEditable) return;

      e.preventDefault();

      if (!moveKeys.includes(e.code)) {
        if (e.code === "Escape") {
          pressed.clear();
          heldCameraKeys.clear();
          stopCameraRepeat();
          lastKeyRef.current = "";
          onMoveRef.current("STOP", { throttle: 0, steering: 0 });
          return;
        }

        const cameraAction = cameraActionFromKey(e.code);
        if (cameraAction) {
          if (e.repeat) return;

          heldCameraKeys.add(e.code);
          onActionRef.current(cameraAction, { amount: 1 });
          startCameraRepeat();
          return;
        }

        if (e.repeat) return;

        if (e.code === "KeyH") {
          onActionPressChangeRef.current?.("HORN", true);
          onActionRef.current("HORN");
        }
        if (e.code === "KeyL") onActionRef.current("LIGHT_TOGGLE");
        if (e.code === "KeyR") {
          onActionPressChangeRef.current?.("CAM_RESET", true);
          onActionRef.current("CAM_RESET");
        }
        if (e.code === "KeyX") onActionRef.current("CAMERA_TOGGLE");

        return;
      }

      pressed.add(e.code);

      computeMove();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const moveKeys = ["KeyW", "KeyA", "KeyS", "KeyD"];
      const cameraKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      const momentaryActionKeys = ["KeyH", "KeyR"];

      if (cameraKeys.includes(e.code)) {
        e.preventDefault();
        heldCameraKeys.delete(e.code);

        if (heldCameraKeys.size === 0) {
          stopCameraRepeat();
        }

        return;
      }

      if (momentaryActionKeys.includes(e.code)) {
        e.preventDefault();

        if (e.code === "KeyH") {
          onActionPressChangeRef.current?.("HORN", false);
        }

        if (e.code === "KeyR") {
          onActionPressChangeRef.current?.("CAM_RESET", false);
        }

        return;
      }

      if (!moveKeys.includes(e.code)) return;

      e.preventDefault();

      pressed.delete(e.code);

      computeMove();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", clearAll);

    return () => {
      stopCameraRepeat();
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", clearAll);
      pressed.clear();
      heldCameraKeys.clear();
    };
  }, [enabled]);
}
