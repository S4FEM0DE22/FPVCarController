"use client";

import { useSyncExternalStore } from "react";

let currentFrameSource = "";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getFrameSource() {
  return currentFrameSource;
}

function getNoFrameSource() {
  return "";
}

function getFrameAvailable() {
  return currentFrameSource.length > 0;
}

function getNoFrameAvailable() {
  return false;
}

export function setCameraFrameSource(nextSource: string) {
  if (nextSource === currentFrameSource) return;
  currentFrameSource = nextSource;
  for (const listener of listeners) listener();
}

export function useCameraFrameSource() {
  return useSyncExternalStore(subscribe, getFrameSource, getNoFrameSource);
}

export function useCameraFrameAvailable() {
  return useSyncExternalStore(
    subscribe,
    getFrameAvailable,
    getNoFrameAvailable
  );
}
