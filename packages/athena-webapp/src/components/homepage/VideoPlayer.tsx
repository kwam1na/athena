import { useEffect, useRef } from "react";
import type Hls from "hls.js";

interface VideoPlayerProps {
  hlsUrl: string;
}

export const VideoPlayer = ({ hlsUrl }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    let disposed = false;
    let hls: Hls | null = null;

    const attachHls = async () => {
      const { default: HlsConstructor } = (await import(
        // @ts-expect-error hls.js publishes its light build without declarations.
        "hls.js/light"
      )) as unknown as { default: typeof Hls };

      if (disposed || !HlsConstructor.isSupported()) return;

      hls = new HlsConstructor();
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
        video.play().catch((e) => console.error("Error playing video:", e));
      });
    };

    void attachHls();

    return () => {
      disposed = true;
      hls?.destroy();
    };
  }, [hlsUrl]);

  return (
    <div className="w-[400px] h-[640px] rounded-lg overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        autoPlay
        loop
        muted
      />
    </div>
  );
};
