"use client";

import { useEffect, useState } from "react";
import type { InputMode } from "@/types/control";

function hasConnectedGamepad() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
  return Array.from(navigator.getGamepads()).some((pad) => pad?.connected);
}

function hasActiveGamepadInput() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
  return Array.from(navigator.getGamepads()).some((pad) =>
    pad?.connected && (
      pad.buttons.some((button) => button.pressed) ||
      Math.abs(pad.axes[0] || 0) > 0.18 ||
      Math.abs(pad.axes[1] || 0) > 0.18 ||
      (pad.mapping === "standard" && (
        Math.abs(pad.axes[2] || 0) > 0.35 ||
        Math.abs(pad.axes[3] || 0) > 0.35
      ))
    )
  );
}

export default function useInputMode(isMobile: boolean) {
  const [manualInputMode, setManualInputMode] = useState<InputMode | null>(() =>
    hasConnectedGamepad() ? "gamepad" : null
  );
  const resolvedManualMode = !isMobile && manualInputMode === "touch" ? null : manualInputMode;
  const inputMode = resolvedManualMode ?? (isMobile ? "touch" : "keyboard");

  useEffect(() => {
    const onKeyDown = () => {
      setManualInputMode("keyboard");
    };

    const onPointerDown = () => {
      if (isMobile && !hasConnectedGamepad()) {
        setManualInputMode("touch");
      }
    };

    const onGamepadConnected = () => {
      setManualInputMode("gamepad");
    };

    const onGamepadDisconnected = () => {
      setManualInputMode(hasConnectedGamepad() ? "gamepad" : null);
    };

    const gamepadPoll = window.setInterval(() => {
      if (!hasConnectedGamepad()) {
        setManualInputMode((current) => current === "gamepad" ? null : current);
      } else if (hasActiveGamepadInput()) {
        setManualInputMode("gamepad");
      }
    }, 100);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("gamepadconnected", onGamepadConnected);
      window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);
      window.clearInterval(gamepadPoll);
    };
  }, [isMobile]);

  return {
    inputMode,
    setInputMode: (mode: InputMode) => setManualInputMode(mode),
  };
}
