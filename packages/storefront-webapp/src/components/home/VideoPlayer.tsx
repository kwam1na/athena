import { useEffect, useRef } from "react";
import Hls from "hls.js";
import { motion } from "framer-motion";

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
    <motion.video
      ref={videoRef}
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: {
          duration: 1,
          ease: [0.6, 0.05, 0.01, 0.9],
        },
      }}
      className="absolute top-0 left-0 w-full h-full object-cover"
      playsInline
      autoPlay
      loop
      muted
    >
      <source src={hlsUrl} type="video/mp4" />
      Your browser does not support the video tag.
    </motion.video>
  );
};
