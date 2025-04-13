import config from "@/config";
import { useStoreContext } from "@/contexts/StoreContext";
import { motion } from "framer-motion";
import Hls from "hls.js";
import { useEffect, useRef } from "react";

export const HomeHero = () => {
  const { store } = useStoreContext();

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsUrl = `${config.hlsURL}/stores/${store?._id}/assets/hero/v${store?.config?.landingPageReelVersion}/reel.m3u8`;

  useEffect(() => {
    if (!videoRef.current || !store?._id) return;
    const video = videoRef.current;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    }
  }, [store?._id]);

  return (
    <section className="relative w-full h-screen flex items-center justify-center text-white text-center">
      {/* <motion.img
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{
          opacity: 1,
          scale: 1,
          transition: {
            duration: 1,
            ease: [0.6, 0.05, 0.01, 0.9],
          },
        }}
        src={store?.config?.showroomImage}
        className="w-full h-screen object-cover"
      /> */}

      {/* Background Video */}
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
        autoPlay
        loop
        muted
        playsInline
      >
        <source src={hlsUrl} type="video/mp4" />
        Your browser does not support the video tag.
      </motion.video>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 0.7,
          transition: {
            duration: 0.5,
            delay: 1.1, // Start after image animation completes
          },
        }}
        className="absolute inset-0 bg-black"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center -translate-y-[10%]">
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut", duration: 0.4, delay: 1.1 },
          }}
          className="text-2xl text-center text-accent5 drop-shadow-lg"
        >
          Switch your look
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut", duration: 0.4, delay: 1.1 },
          }}
          className="font-lavish text-8xl md:text-9xl text-center text-accent5 drop-shadow-lg"
        >
          to match your mood
        </motion.p>
      </div>
    </section>
  );
};
