import { useQuery } from "@tanstack/react-query";
import Footer from "./footer/Footer";
import { useEffect, useRef, useState } from "react";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { useProductQueries } from "@/lib/queries/product";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { MARKER_KEY } from "@/lib/constants";
import { ProductReminderBar } from "./ProductReminderBar";
import { PromoAlert } from "./home/PromoAlert";
import { usePromoAlert } from "@/hooks/usePromoAlert";
import { useProductReminder } from "@/hooks/useProductReminder";
import { HomeHeroSectionWithRef } from "./home/HomeHeroSection";
import { BestSellersSection } from "./home/BestSellersSection";
import { FeaturedProductsSection } from "./home/FeaturedProductsSection";
import { useSearch } from "@tanstack/react-router";
import { RewardsAlert } from "./home/RewardsAlert";
import { useDiscountCodeAlert } from "@/hooks/useDiscountCodeAlert";
import { useRewardsAlert } from "@/hooks/useRewardsAlert";
import { WelcomeBackModal } from "./ui/modals/WelcomeBackModal";
import { ChevronDown, GiftIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useStoreContext } from "@/contexts/StoreContext";
import { postAnalytics } from "@/api/analytics";
import { useUpsellsQueries } from "@/lib/queries/upsells";
import { UpsellModal } from "./ui/modals/UpsellModal";
import { getRelativeTime } from "@/lib/utils";

const origin = "homepage";

export default function HomePage() {
  const homeHeroRef = useRef<HTMLDivElement>(null);
  const bestSellersRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  const { store } = useStoreContext();

  // console.log("store", store);

  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();

  // Use extracted custom hooks
  // const { isPromoAlertOpen, handleClosePromoAlert } = usePromoAlert();

  // const {
  //   isRewardsAlertOpen,
  //   isRewardsAlertDismissed,
  //   handleCloseRewardsAlert,
  //   lastRewardsAlertShownTime,
  // } = useRewardsAlert();

  const {
    isDiscountModalOpen,
    setIsDiscountModalOpen,
    handleCloseDiscountModal,
    completeDiscountModalFlow,
    hasDiscountModalBeenShown,
    hasCompletedDiscountModalFlow,
    setHasDiscountModalBeenShown,
    isDiscountModalDismissed,
    lastDiscountModalShownTime,
    isDiscountModalStateLoaded,
    openDiscountModal,
  } = useDiscountCodeAlert();

  const [hasScrolledPastThreshold, setHasScrolledPastThreshold] =
    useState(false);

  // const { showReminderBar, setShowReminderBar, upsell } =
  //   useProductReminder(homeHeroRef);

  const productQueries = useProductQueries();

  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery(
    productQueries.bestSellers()
  );

  const { data: featured, isLoading: isLoadingFeatured } = useQuery(
    productQueries.featured()
  );

  const s = useSearch({ strict: false });

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
    setNavBarLayout("sticky");
    setAppLocation(origin);

    // generate a random uuid and save it to local storage
    const uuid = localStorage.getItem(MARKER_KEY);
    if (!uuid) {
      localStorage.setItem(MARKER_KEY, Math.random().toString(36).substring(7));
    }
  }, []);

  useTrackEvent({
    action: "viewed_homepage",
    origin: s.utm_source,
  });

  const handleClickOnDiscountCode = async () => {
    openDiscountModal();

    await postAnalytics({
      action: "clicked_on_discount_code_trigger",
      origin: "homepage",
      data: {
        promoCodeId: store?.config?.homepageDiscountCodeModalPromoCode,
      },
    });
  };

  const bestSellersSorted = bestSellers?.sort(
    (a: any, b: any) => a.rank - b.rank
  );

  const bestSellersProducts = bestSellersSorted?.map((bestSeller: any) => {
    return bestSeller.productSku;
  });

  const featuredSectionSorted = featured
    ?.sort((a: any, b: any) => a.rank - b.rank)
    .filter((item: any) => item.type === "regular");

  const shopLookSorted = featured
    ?.sort((a, b) => (a.rank || 0) - (b.rank || 0))
    .filter((item) => item.type === "shop_look");

  const shopLookProduct = shopLookSorted?.[0];

  const isLoading = isLoadingBestSellers || isLoadingFeatured;

  if (isLoading) return <div className="h-screen" />;

  const lastDiscountModalShownTimeAgo =
    Date.now() - (lastDiscountModalShownTime || 0);

  const meetsConditionsToShowUpsell =
    lastDiscountModalShownTimeAgo > 1000 * 60 * 60 * 24 &&
    isDiscountModalDismissed;

  // const meetsConditionsToShowUpsell = true;

  return (
    <>
      {/* <PromoAlert
        isOpen={isPromoAlertOpen && !isRewardsAlertOpen}
        onClose={handleClosePromoAlert}
      /> */}

      {/* <RewardsAlert
        isOpen={isRewardsAlertOpen && !isRewardsAlertDismissed}
        onClose={handleCloseRewardsAlert}
      /> */}

      {meetsConditionsToShowUpsell && (
        <UpsellModal
          promoCode={store?.config?.homepageDiscountCodeModalPromoCode}
        />
      )}

      <WelcomeBackModal
        isOpen={isDiscountModalOpen}
        onClose={handleCloseDiscountModal}
        onSuccess={completeDiscountModalFlow}
        promoCode={store?.config?.homepageDiscountCodeModalPromoCode}
      />

      {/* Floating welcome back button */}
      {!hasCompletedDiscountModalFlow &&
        store?.config?.homepageDiscountCodeModalPromoCode && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 2.6, ease: "easeIn" }}
            onClick={handleClickOnDiscountCode}
            className="fixed right-4 top-1/2 transform -translate-y-1/2 z-10 bg-accent5/60 text-primary rounded-full p-3 shadow-md flex items-center transition-all duration-100 hover:scale-105"
            aria-label="Special offer"
          >
            <GiftIcon className="h-5 w-5" />
          </motion.button>
        )}

      <div className="min-h-screen overflow-x-hidden">
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
              {Boolean(bestSellersSorted?.length) && (
                <div ref={bestSellersRef} className="relative md:mt-0">
                  <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-b from-transparent to-white/10 md:hidden" />
                  <BestSellersSection
                    bestSellersProducts={bestSellersProducts || []}
                    origin={origin}
                  />
                </div>
              )}

              {/* Featured Products Section */}
              {Boolean(featuredSectionSorted?.length) && (
                <FeaturedProductsSection
                  featuredSectionSorted={featuredSectionSorted}
                  origin={origin}
                />
              )}
            </div>
          </div>
        </div>

        <Footer ref={footerRef} />

        {/* {upsell && !isPromoAlertOpen && (
          <ProductReminderBar
            product={upsell}
            isVisible={showReminderBar && upsell.quantityAvailable > 0}
            onDismiss={() => {
              setShowReminderBar(false);
            }}
            footerRef={footerRef}
          />
        )} */}
      </div>
    </>
  );
}
