"use client";

import { useCallback, useRef, type MutableRefObject } from "react";
import { clamp } from "@/lib/math";
import type { ActionCommand, ControlCommand } from "@/types/control";
import type { ControllerTuningSettings } from "@/components/controller/ControllerInsightsModal";

interface UseControllerInputHandlersOptions {
  tuning: ControllerTuningSettings;
  onUserInput: () => void;
  handleTouchMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  handleTouchAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
  handleKeyboardMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  handleKeyboardAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
  handleGamepadMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  handleGamepadAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
}

function applyDeadzoneAndGain(value: number, gain: number, deadzone: number) {
  const scaled = clamp(value * gain, -1, 1);
  if (Math.abs(scaled) < deadzone) return 0;
  return Number(scaled.toFixed(3));
}

const MOVE_SEND_INTERVAL_MS = 90;
const ACTION_SEND_INTERVAL_MS = 220;

function shouldSendTimed(
  lastSentAtRef: MutableRefObject<number>,
  intervalMs: number
) {
  const now = Date.now();
  if (now - lastSentAtRef.current < intervalMs) return false;
  lastSentAtRef.current = now;
  return true;
}

export default function useControllerInputHandlers({
  tuning,
  onUserInput,
  handleTouchMove,
  handleTouchAction,
  handleKeyboardMove,
  handleKeyboardAction,
  handleGamepadMove,
  handleGamepadAction,
}: UseControllerInputHandlersOptions) {
  const lastTouchMoveAtRef = useRef(0);
  const lastTouchActionAtRef = useRef(0);
  const lastGamepadMoveAtRef = useRef(0);
  const lastGamepadActionAtRef = useRef(0);

  const handleTouchMoveWithTuning = useCallback(
    (command: ControlCommand, payload?: Record<string, unknown>) => {
      onUserInput();

      if (!payload) {
        handleTouchMove(command);
        return;
      }

      const nextPayload = { ...payload };
      const steeringRaw = typeof payload.steering === "number" ? payload.steering : null;
      const throttleRaw = typeof payload.throttle === "number" ? payload.throttle : null;

      if (steeringRaw === null || throttleRaw === null) {
        handleTouchMove(command, payload);
        return;
      }

      const steering = applyDeadzoneAndGain(
        steeringRaw,
        tuning.touchSteeringGain,
        tuning.touchDeadzone
      );
      const throttle = applyDeadzoneAndGain(
        throttleRaw,
        tuning.touchThrottleGain,
        tuning.touchDeadzone
      );

      nextPayload.steering = steering;
      nextPayload.throttle = throttle;

      const nextCommand = steering === 0 && throttle === 0 ? "STOP" : command;

      if (
        nextCommand !== "STOP" &&
        !shouldSendTimed(lastTouchMoveAtRef, MOVE_SEND_INTERVAL_MS)
      ) {
        return;
      }

      handleTouchMove(nextCommand, nextPayload);
    },
    [handleTouchMove, onUserInput, tuning]
  );

  const handleTouchActionWithTuning = useCallback(
    (action: ActionCommand, payload?: Record<string, unknown>) => {
      onUserInput();

      if (!payload || typeof payload.amount !== "number") {
        if (!shouldSendTimed(lastTouchActionAtRef, ACTION_SEND_INTERVAL_MS)) {
          return;
        }
        handleTouchAction(action, payload);
        return;
      }

      if (!shouldSendTimed(lastTouchActionAtRef, ACTION_SEND_INTERVAL_MS)) {
        return;
      }

      handleTouchAction(action, {
        ...payload,
        amount: clamp(payload.amount * tuning.cameraActionGain, 0, 1),
      });
    },
    [handleTouchAction, onUserInput, tuning.cameraActionGain]
  );

  const handleKeyboardMoveWithWatchdog = useCallback(
    (command: ControlCommand, payload?: Record<string, unknown>) => {
      onUserInput();
      handleKeyboardMove(command, payload);
    },
    [handleKeyboardMove, onUserInput]
  );

  const handleKeyboardActionWithWatchdog = useCallback(
    (action: ActionCommand, payload?: Record<string, unknown>) => {
      onUserInput();
      handleKeyboardAction(action, payload);
    },
    [handleKeyboardAction, onUserInput]
  );

  const handleGamepadMoveWithWatchdog = useCallback(
    (command: ControlCommand, payload?: Record<string, unknown>) => {
      onUserInput();
      if (
        command !== "STOP" &&
        !shouldSendTimed(lastGamepadMoveAtRef, MOVE_SEND_INTERVAL_MS)
      ) {
        return;
      }
      handleGamepadMove(command, payload);
    },
    [handleGamepadMove, onUserInput]
  );

  const handleGamepadActionWithWatchdog = useCallback(
    (action: ActionCommand, payload?: Record<string, unknown>) => {
      onUserInput();
      if (!shouldSendTimed(lastGamepadActionAtRef, ACTION_SEND_INTERVAL_MS)) {
        return;
      }
      handleGamepadAction(action, payload);
    },
    [handleGamepadAction, onUserInput]
  );

  return {
    handleTouchMoveWithTuning,
    handleTouchActionWithTuning,
    handleKeyboardMoveWithWatchdog,
    handleKeyboardActionWithWatchdog,
    handleGamepadMoveWithWatchdog,
    handleGamepadActionWithWatchdog,
  };
}
