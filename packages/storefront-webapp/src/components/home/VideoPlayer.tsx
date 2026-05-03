import { motion } from "framer-motion";
import type Hls from "hls.js";
import { useEffect, useRef } from "react";

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
