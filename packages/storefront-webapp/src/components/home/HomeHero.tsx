import { useStoreContext } from "@/contexts/StoreContext";
import { motion } from "framer-motion";
import { lazy, Suspense } from "react";
import { ScrollDownButton } from "../ui/ScrollDownButton";
import { getStoreConfigV2 } from "@/lib/storeConfig";

interface HomeHeroProps {
  nextSectionRef?: React.RefObject<HTMLDivElement>;
}

const LazyVideoPlayer = lazy(async () => {
  const module = await import("./VideoPlayer");

  return { default: module.VideoPlayer };
});

export const HomeHero = ({ nextSectionRef }: HomeHeroProps) => {
  const { store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);

  const hlsUrl = storeConfig.media.reels.activeHlsUrl;

  // Determine which hero to display (default to "reel" for backward compatibility)
  const heroDisplayType = storeConfig.media.homeHero.displayType || "reel";

  const shouldShowImage =
    heroDisplayType === "image" && storeConfig.media.homeHero.headerImage;

  const shouldShowVideo =
    (heroDisplayType === "reel" ||
      (heroDisplayType === "image" &&
        storeConfig.media.homeHero.headerImage === undefined)) &&
    Boolean(hlsUrl);

  // Determine overlay and text visibility (default to true for backward compatibility)
  const shouldShowOverlay = storeConfig.media.homeHero.showOverlay === true;

  const shouldShowText = storeConfig.media.homeHero.showText === true;

  return (
    <section className="relative w-full h-screen flex items-center justify-center text-white text-center">
      {/* Background Video - shown when heroDisplayType is "reel" or not set */}
      {shouldShowVideo && hlsUrl && (
        <Suspense fallback={null}>
          <LazyVideoPlayer hlsUrl={hlsUrl} />
        </Suspense>
      )}

      {/* Background Image - shown when heroDisplayType is "image" */}
      {shouldShowImage && (
        <motion.img
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{
            opacity: 1,
            scale: 1,
            transition: {
              duration: 1,
              ease: [0.6, 0.05, 0.01, 0.9],
            },
          }}
          src={storeConfig.media.homeHero.headerImage}
          className="absolute top-0 left-0 w-full h-full object-cover"
          alt="Hero header"
        />
      )}

      {/* Dark Overlay - conditionally shown */}
      {shouldShowOverlay && (
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
      )}

      {/* Text Content - conditionally shown */}
      {shouldShowText && (
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
      )}

      {/* Scroll down button - positioned at bottom of hero section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 0.6 }}
        className="absolute bottom-28 md:bottom-4 left-0 right-0 flex justify-center"
      >
        <ScrollDownButton targetRef={nextSectionRef} />
      </motion.div>
    </section>
  );
};
