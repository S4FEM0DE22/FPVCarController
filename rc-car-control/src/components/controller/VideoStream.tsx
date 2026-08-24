"use client";

import { useCameraFrameSource } from "@/lib/cameraFrameStore";

interface VideoStreamProps {
  streamUrl?: string;
  cameraOn: boolean;
  className?: string;
  onStreamLoad?: () => void;
  onStreamError?: () => void;
}

export default function VideoStream({
  streamUrl = "",
  cameraOn,
  className,
  onStreamLoad,
  onStreamError,
}: VideoStreamProps) {
  const frameSrc = useCameraFrameSource();
  const isHttpStreamUrl = /^https?:\/\//i.test(streamUrl);
  const effectiveStreamUrl = cameraOn && isHttpStreamUrl ? streamUrl : "";
  const effectiveFrameSrc = cameraOn && frameSrc ? frameSrc : "";
  const videoClassName = className ?? "video";

  if (effectiveFrameSrc) {
    return (
      // Cloud relay frames are already JPEG data URLs.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={effectiveFrameSrc}
        alt="ESP32-CAM cloud frame"
        className={videoClassName}
        decoding="async"
        draggable={false}
        onLoad={onStreamLoad}
        onError={onStreamError}
      />
    );
  }

  if (effectiveStreamUrl) {
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
      {cameraOn ? "กำลังเชื่อมต่อภาพจากกล้อง..." : "กล้องปิดอยู่"}
    </div>
  );
}
