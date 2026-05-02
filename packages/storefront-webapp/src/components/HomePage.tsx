import { useQuery } from "@tanstack/react-query";
import Footer from "./footer/Footer";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { useProductQueries } from "@/lib/queries/product";
import { MARKER_KEY } from "@/lib/constants";
import { ProductReminderBar } from "./ProductReminderBar";
import { useProductReminder } from "@/hooks/useProductReminder";
import { HomeHeroSectionWithRef } from "./home/HomeHeroSection";
import { BestSellersSection } from "./home/BestSellersSection";
import { FeaturedProductsSection } from "./home/FeaturedProductsSection";
import { useDiscountCodeAlert } from "@/hooks/useDiscountCodeAlert";
import { useLeaveAReviewModal } from "@/hooks/useLeaveAReviewModal";
import { GiftIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useStoreContext } from "@/contexts/StoreContext";
import { postAnalytics } from "@/api/analytics";
import { LeaveAReviewModal } from "./ui/modals/LeaveAReviewModal";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import { createLandingPageViewedEvent } from "@/lib/storefrontJourneyEvents";
import { resolveHomepageContent } from "./home/homePageContent";
import type { HomePageLoaderData } from "@/routes/-homePageLoader";

const origin = "homepage";

type HomePageReadyShellProps = {
  children: ReactNode;
};

export function HomePageReadyShell({ children }: HomePageReadyShellProps) {
  return (
    <div
      data-testid="storefront-homepage-ready"
      className="min-h-screen overflow-x-hidden"
    >
      {children}
    </div>
  );
}

export default function HomePage({
  initialData,
}: {
  initialData?: HomePageLoaderData;
}) {
  const homeHeroRef = useRef<HTMLDivElement>(null);
  const bestSellersRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const hasTrackedLandingPageView = useRef(false);

  const { store, userId } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);
  const { track } = useStorefrontObservability();

  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();

  const [shouldLoadEngagementPrompts, setShouldLoadEngagementPrompts] =
    useState(false);

  const {
    setIsDiscountModalOpen,
    hasDiscountModalBeenShown,
    setHasDiscountModalBeenShown,
    isDiscountModalDismissed,
    isDiscountModalStateLoaded,
    redeemedOffers,
  } = useDiscountCodeAlert({
    enabled: shouldLoadEngagementPrompts,
  });

  const {
    isLeaveReviewModalOpen,
    handleCloseLeaveReviewModal,
    handleSuccessLeaveReviewModal,
    hasCompletedLeaveReviewModalFlow,
    openLeaveReviewModal,
    canShowModal,
  } = useLeaveAReviewModal({
    enabled: shouldLoadEngagementPrompts,
  });

  const [hasScrolledPastThreshold, setHasScrolledPastThreshold] =
    useState(false);

  const { upsell, setShowReminderBar, showReminderBar } =
    useProductReminder(homeHeroRef);

  const productQueries = useProductQueries();

  const initialBestSellers = initialData?.bestSellers?.data;
  const initialBestSellersUpdatedAt = initialData?.bestSellers?.updatedAt;
  const initialFeatured = initialData?.featured?.data;
  const initialFeaturedUpdatedAt = initialData?.featured?.updatedAt;

  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery({
    ...productQueries.bestSellers(),
    initialData: initialBestSellers,
    initialDataUpdatedAt: initialBestSellersUpdatedAt,
    refetchOnMount: initialBestSellers ? false : undefined,
  });

  const { data: featured, isLoading: isLoadingFeatured } = useQuery({
    ...productQueries.featured(),
    initialData: initialFeatured,
    initialDataUpdatedAt: initialFeaturedUpdatedAt,
    refetchOnMount: initialFeatured ? false : undefined,
  });

  // Handle scroll events - now only runs after localStorage is loaded
  useEffect(() => {
    // Don't add scroll listener until localStorage state is fully loaded
    if (!isDiscountModalStateLoaded) return;

    const handleScroll = () => {
      const scrollPosition = window.scrollY;

      // Check if user has scrolled past the threshold and the modal hasn't been shown yet
      if (
        scrollPosition > window.innerHeight * 0.9 &&
        !hasScrolledPastThreshold &&
        !hasDiscountModalBeenShown &&
        !isDiscountModalDismissed // Also check if it was dismissed
      ) {
        setHasScrolledPastThreshold(true);
        setIsDiscountModalOpen(true);
        setHasDiscountModalBeenShown(true);
      }
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [
    hasScrolledPastThreshold,
    hasDiscountModalBeenShown,
    isDiscountModalDismissed,
    isDiscountModalStateLoaded,
  ]);

  useEffect(() => {
    if (shouldLoadEngagementPrompts) return;

    const enablePrompts = () => {
      setShouldLoadEngagementPrompts(true);
    };

    window.addEventListener("scroll", enablePrompts, { passive: true, once: true });
    window.addEventListener("pointerdown", enablePrompts, { passive: true, once: true });
    window.addEventListener("keydown", enablePrompts, { once: true });
    window.addEventListener("touchstart", enablePrompts, { passive: true, once: true });

    return () => {
      window.removeEventListener("scroll", enablePrompts);
      window.removeEventListener("pointerdown", enablePrompts);
      window.removeEventListener("keydown", enablePrompts);
      window.removeEventListener("touchstart", enablePrompts);
    };
  }, [shouldLoadEngagementPrompts]);

  useEffect(() => {
    setNavBarLayout("sticky");
    setAppLocation(origin);

    // generate a random uuid and save it to local storage
    const uuid = localStorage.getItem(MARKER_KEY);
    if (!uuid) {
      localStorage.setItem(MARKER_KEY, Math.random().toString(36).substring(7));
    }
  }, []);

  useEffect(() => {
    if (hasTrackedLandingPageView.current) return;
    if (!userId) return;

    hasTrackedLandingPageView.current = true;

    void track(createLandingPageViewedEvent()).catch((error) => {
      console.error("Failed to track landing page view:", error);
    });
  }, [track, userId]);

  const handleClickOnLeaveReviewButton = async () => {
    openLeaveReviewModal();

    await postAnalytics({
      action: "clicked_on_leave_review_trigger",
      origin: "homepage",
      data: {
        promoCodeId: storeConfig.promotions.leaveAReviewDiscountCodeModalPromoCode,
      },
    });
  };

  const {
    bestSellersProducts,
    featuredSectionSorted,
    shopLookProduct,
    hasHomepageData,
  } = resolveHomepageContent({
    bestSellers: bestSellers as any,
    featured: featured as any,
  });

  const isLoading = isLoadingBestSellers || isLoadingFeatured;

  return (
    <>
      {/* Floating leave a review button */}
      {!hasCompletedLeaveReviewModalFlow &&
        storeConfig.promotions.leaveAReviewDiscountCodeModalPromoCode &&
        canShowModal && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 2.6, ease: "easeIn" }}
            onClick={handleClickOnLeaveReviewButton}
            className="fixed right-4 top-1/2 transform -translate-y-1/2 z-10 bg-accent5/60 text-primary rounded-full p-3 shadow-md flex items-center transition-all duration-100 hover:scale-105"
            aria-label="Leave a review"
          >
            <GiftIcon className="h-5 w-5" />
          </motion.button>
        )}

      <LeaveAReviewModal
        isOpen={isLeaveReviewModalOpen && canShowModal}
        onClose={handleCloseLeaveReviewModal}
        onSuccess={handleSuccessLeaveReviewModal}
        promoCode={storeConfig.promotions.leaveAReviewDiscountCodeModalPromoCode}
      />

      <HomePageReadyShell>
        <div className="overflow-x-hidden">
          <div className="space-y-16 md:space-y-56 pb-32">
            {/* Hero Section */}
            <HomeHeroSectionWithRef
              heroRef={homeHeroRef}
              shopLookProduct={shopLookProduct}
              origin={origin}
              nextSectionRef={bestSellersRef}
            />

            <div className="container mx-auto space-y-24 md:space-y-48 pb-8 px-4 lg:px-0">
              {/* Best Sellers Section with peek-a-boo effect on mobile */}
              {!hasHomepageData && isLoading && (
                <div
                  data-testid="homepage-critical-content"
                  className="min-h-[12rem]"
                />
              )}

              {Boolean(bestSellersProducts.length) && (
                <div ref={bestSellersRef} className="relative md:mt-0">
                  <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-b from-transparent to-white/10 md:hidden" />
                  <BestSellersSection
                    bestSellersProducts={bestSellersProducts}
                    origin={origin}
                  />
                </div>
              )}

              {/* Featured Products Section */}
              {Boolean(featuredSectionSorted.length) && (
                <FeaturedProductsSection
                  featuredSectionSorted={featuredSectionSorted}
                  origin={origin}
                />
              )}
            </div>
          </div>
        </div>

        <Footer
          ref={footerRef}
          deferCategories
        />

        {upsell && (
          <ProductReminderBar
            product={upsell}
            redeemedOffer={redeemedOffers?.[0]}
            isVisible={showReminderBar}
            onDismiss={() => {
              setShowReminderBar(false);
            }}
            footerRef={footerRef}
          />
        )}
      </HomePageReadyShell>
    </>
  );
}
