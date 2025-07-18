import config from "@/config";
import { useStoreContext } from "@/contexts/StoreContext";
import { motion } from "framer-motion";
import Hls from "hls.js";
import { useEffect, useRef } from "react";
import { ScrollDownButton } from "../ui/ScrollDownButton";
import { VideoPlayer } from "./VideoPlayer";

interface HomeHeroProps {
  nextSectionRef?: React.RefObject<HTMLDivElement>;
}

export const HomeHero = ({ nextSectionRef }: HomeHeroProps) => {
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
      <VideoPlayer hlsUrl={hlsUrl} />

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

      {/* Scroll down button - positioned at bottom of hero section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 0.6 }}
        className="absolute bottom-24 md:bottom-4 left-0 right-0 flex justify-center"
      >
        <ScrollDownButton targetRef={nextSectionRef} />
      </motion.div>
    </section>
  );
};
