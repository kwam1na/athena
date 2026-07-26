import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ScrollDownButton } from "../ui/ScrollDownButton";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import { Button } from "../ui/button";
import { StorefrontImage } from "../ui/storefront-image";

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
  const isStoreResolved = Boolean(store);
  const shouldShowFallback =
    isStoreResolved && !shouldShowImage && !shouldShowVideo;

  return (
    <section className="relative flex min-h-screen w-full items-center justify-center bg-background text-action-foreground text-center">
      {/* Background Video - shown when heroDisplayType is "reel" or not set */}
      {shouldShowVideo && hlsUrl && (
        <Suspense fallback={null}>
          <LazyVideoPlayer hlsUrl={hlsUrl} />
        </Suspense>
      )}

      {/* Background Image - shown when heroDisplayType is "image" */}
      {shouldShowImage && (
        <StorefrontImage
          src={storeConfig.media.homeHero.headerImage}
          wrapperClassName="absolute inset-0 h-full w-full"
          alt="Hero header"
        />
      )}

      {/* Dark Overlay - conditionally shown */}
      {shouldShowOverlay && (
        <div className="absolute inset-0 bg-overlay/70" />
      )}

      {shouldShowFallback && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-action px-gutter text-action-foreground">
          <div className="max-w-xl space-y-layout-md">
            <p className="text-sm uppercase tracking-widest">
              {store?.name ?? "Storefront"}
            </p>
            <h1 className="font-lavish text-7xl md:text-9xl">
              Find your next look
            </h1>
            <Link
              to="/shop/$categorySlug"
              params={{ categorySlug: "hair" }}
              search={{ origin: "homepage_hero_fallback" }}
            >
              <Button variant="secondary">Shop hair</Button>
            </Link>
          </div>
        </div>
      )}

      {!isStoreResolved && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-background"
          data-testid="homepage-hero-media-pending"
        />
      )}

      {/* Text Content - conditionally shown */}
      {shouldShowText && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-gutter">
          <p className="text-2xl text-center text-action-foreground drop-shadow-lg">
            Switch your look
          </p>
          <p className="font-lavish text-8xl md:text-9xl text-center text-action-foreground drop-shadow-lg">
            to match your mood
          </p>
        </div>
      )}

      {/* Scroll down button - positioned at bottom of hero section */}
      <div className="absolute bottom-28 md:bottom-4 left-0 right-0 flex justify-center">
        <ScrollDownButton targetRef={nextSectionRef} />
      </div>
    </section>
  );
};
