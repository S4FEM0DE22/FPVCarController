"use client";

import { useCameraFrameSource, useCameraFrameStalled } from "@/lib/cameraFrameStore";

interface VideoStreamProps {
  streamUrl?: string;
  cameraOn: boolean;
  className?: string;
  onStreamLoad?: () => void;
  onStreamError?: () => void;
  showStaleIndicator?: boolean;
}

export default function VideoStream({
  streamUrl = "",
  cameraOn,
  className,
  onStreamLoad,
  onStreamError,
  showStaleIndicator = true,
}: VideoStreamProps) {
  const frameSrc = useCameraFrameSource();
  const frameStalled = useCameraFrameStalled();
  const isHttpStreamUrl = /^https?:\/\//i.test(streamUrl);
  const effectiveStreamUrl = cameraOn && isHttpStreamUrl ? streamUrl : "";
  const effectiveFrameSrc = cameraOn && frameSrc ? frameSrc : "";
  const videoClassName = className ?? "video";

  if (effectiveFrameSrc) {
    return (
      <>
        {/* JPEG frames are decoded before their Blob URL is published. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={effectiveFrameSrc}
          alt="ESP32-CAM cloud frame"
          aria-label={frameStalled ? "ภาพล่าสุดที่ได้รับ ไม่ใช่ภาพสด" : undefined}
          className={videoClassName}
          decoding="async"
          draggable={false}
          onLoad={onStreamLoad}
          onError={onStreamError}
        />
        {frameStalled && showStaleIndicator && (
          <div role="status" className="pointer-events-none absolute inset-x-0 bottom-36 z-10 flex justify-center px-16">
            <span className="rounded border border-amber-300/60 bg-black/85 px-3 py-1 text-center text-xs font-semibold text-amber-200">
              ภาพหยุดอัปเดต แสดงภาพล่าสุด
            </span>
          </div>
        )}
      </>
    );
  }

  if (effectiveStreamUrl && !frameStalled) {
    return (
      // MJPEG/ESP32-CAM streams are not compatible with next/image optimization.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={effectiveStreamUrl}
        alt="ESP32-CAM stream"
        className={videoClassName}
        draggable={false}
        onLoad={onStreamLoad}
        onError={onStreamError}
      />
    );
  }

  return (
    <div className={`${videoClassName} flex items-center justify-center bg-black/85 text-sm font-semibold text-white/85`}>
      {cameraOn
        ? frameStalled ? "ภาพหยุดอัปเดต กำลังรอภาพใหม่..." : "กำลังเชื่อมต่อภาพจากกล้อง..."
        : "กล้องปิดอยู่"}
    </div>
  );
}
