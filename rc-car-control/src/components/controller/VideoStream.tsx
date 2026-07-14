interface VideoStreamProps {
  streamUrl?: string;
  frameSrc?: string;
  cameraOn: boolean;
  className?: string;
}

export default function VideoStream({
  streamUrl = "",
  frameSrc = "",
  cameraOn,
  className,
}: VideoStreamProps) {
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
        draggable={false}
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
      />
    );
  }

  return (
    <div className={`${videoClassName} flex items-center justify-center bg-black/85 text-sm font-semibold text-white/85`}>
      {cameraOn ? "Connecting camera stream..." : "Camera is OFF"}
    </div>
  );
}
