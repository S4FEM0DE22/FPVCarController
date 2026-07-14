"use client";

import { useEffect, useState } from "react";

export default function useControllerLayout(isMobile: boolean) {
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(orientation: landscape)").matches;
  });

  const [showSettings, setShowSettings] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState(false);

  useEffect(() => {
    if (!isMobile) return;

    const updateOrientation = () => {
      setIsLandscape(window.matchMedia("(orientation: landscape)").matches);
    };

    updateOrientation();
    window.addEventListener("resize", updateOrientation);
    window.addEventListener("orientationchange", updateOrientation);

    return () => {
      window.removeEventListener("resize", updateOrientation);
      window.removeEventListener("orientationchange", updateOrientation);
    };
  }, [isMobile]);

  const tryLockLandscape = async () => {
    try {
      const orientationApi = (screen as Screen & {
        orientation?: { lock?: (orientation: string) => Promise<void> };
      }).orientation;

      if (orientationApi?.lock) {
        await orientationApi.lock("landscape");
      }
    } catch {
      // Some browsers require full-screen or do not support orientation lock.
    }
  };

  return {
    isLandscape,
    showSettings,
    setShowSettings,
    fullscreenMode,
    setFullscreenMode,
    tryLockLandscape,
  };
}
