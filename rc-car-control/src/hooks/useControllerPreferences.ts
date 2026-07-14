"use client";

import { useEffect, useState } from "react";
import type {
  ControllerAlertRules,
  ControllerTuningSettings,
  ControllerWatchdogSettings,
} from "@/components/controller/ControllerInsightsModal";
import {
  DEFAULT_SOFT_CODE_PROFILE,
  normalizeSoftCodeProfile,
} from "@/lib/softCodeProfile";
import type { VehicleSoftCodeProfile } from "@/types/control";

const TUNING_STORAGE_KEY = "controller.tuning.v1";
const WATCHDOG_STORAGE_KEY = "controller.watchdog.v1";
const ALERT_RULES_STORAGE_KEY = "controller.alert-rules.v1";
const SOFT_CODE_PROFILE_STORAGE_KEY = "controller.soft-code-profile.v1";

export const DEFAULT_TUNING: ControllerTuningSettings = {
  touchSteeringGain: 1,
  touchThrottleGain: 1,
  touchDeadzone: 0.08,
  cameraActionGain: 1,
};

const DEFAULT_WATCHDOG: ControllerWatchdogSettings = {
  enabled: true,
  timeoutMs: 4500,
};

const DEFAULT_ALERT_RULES: ControllerAlertRules = {
  enabled: true,
  batteryBelow: 20,
  latencyAbove: 180,
  wifiBelow: -75,
};

function loadStoredValue<T>(storageKey: string, fallback: T) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return {
      ...fallback,
      ...JSON.parse(raw),
    } as T;
  } catch {
    return fallback;
  }
}

export default function useControllerPreferences() {
  const [tuning, setTuning] = useState<ControllerTuningSettings>(() =>
    loadStoredValue(TUNING_STORAGE_KEY, DEFAULT_TUNING)
  );
  const [watchdog, setWatchdog] = useState<ControllerWatchdogSettings>(() =>
    loadStoredValue(WATCHDOG_STORAGE_KEY, DEFAULT_WATCHDOG)
  );
  const [alertRules, setAlertRules] = useState<ControllerAlertRules>(() =>
    loadStoredValue(ALERT_RULES_STORAGE_KEY, DEFAULT_ALERT_RULES)
  );
  const [softCodeProfile, setSoftCodeProfile] = useState<VehicleSoftCodeProfile>(() =>
    normalizeSoftCodeProfile(loadStoredValue(SOFT_CODE_PROFILE_STORAGE_KEY, DEFAULT_SOFT_CODE_PROFILE))
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(tuning));
    } catch {
      // Ignore storage write failures.
    }
  }, [tuning]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WATCHDOG_STORAGE_KEY, JSON.stringify(watchdog));
    } catch {
      // Ignore storage write failures.
    }
  }, [watchdog]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ALERT_RULES_STORAGE_KEY, JSON.stringify(alertRules));
    } catch {
      // Ignore storage write failures.
    }
  }, [alertRules]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SOFT_CODE_PROFILE_STORAGE_KEY,
        JSON.stringify(softCodeProfile)
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [softCodeProfile]);

  return {
    tuning,
    setTuning,
    watchdog,
    setWatchdog,
    alertRules,
    setAlertRules,
    softCodeProfile,
    setSoftCodeProfile,
  };
}
