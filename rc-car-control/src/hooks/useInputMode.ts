"use client";

import { useEffect, useState } from "react";
import type { InputMode } from "@/types/control";

function hasConnectedGamepad() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
  return Array.from(navigator.getGamepads()).some((pad) => pad?.connected);
}

export default function useInputMode(isMobile: boolean) {
  const [manualInputMode, setManualInputMode] = useState<InputMode | null>(() =>
    hasConnectedGamepad() ? "gamepad" : null
  );
  const inputMode = manualInputMode ?? (isMobile ? "touch" : "keyboard");

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
      if (hasConnectedGamepad()) {
        setManualInputMode((current) => current ?? "gamepad");
      }
    }, 1000);

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
