import { useEffect, useRef } from "react";
import Hls from "hls.js";

interface VideoPlayerProps {
  hlsUrl: string;
}

export const VideoPlayer = ({ hlsUrl }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    // Use native Safari HLS playback first
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.play().catch((e) => console.error("Error playing video:", e));
    }
    // Fall back to HLS.js
    else if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch((e) => console.error("Error playing video:", e));
      });

      return () => {
        hls.destroy();
      };
    }
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
