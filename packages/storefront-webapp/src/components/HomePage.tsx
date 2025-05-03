import { useQuery } from "@tanstack/react-query";
import Footer from "./footer/Footer";
import { useEffect, useRef } from "react";
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

const origin = "homepage";

export default function HomePage() {
  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();
  const homeHeroRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Use extracted custom hooks
  const { isPromoAlertOpen, setIsPromoAlertOpen } = usePromoAlert();
  const { showReminderBar, setShowReminderBar, upsell } =
    useProductReminder(homeHeroRef);

  const productQueries = useProductQueries();

  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery(
    productQueries.bestSellers()
  );

  const { data: featured, isLoading: isLoadingFeatured } = useQuery(
    productQueries.featured()
  );

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
  });

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

  return (
    <>
      <PromoAlert isOpen={isPromoAlertOpen} setIsOpen={setIsPromoAlertOpen} />
      <div className="min-h-screen">
        <div className="overflow-hidden">
          <div className="space-y-56 pb-32">
            {/* Hero Section */}
            <HomeHeroSectionWithRef
              heroRef={homeHeroRef}
              shopLookProduct={shopLookProduct}
              origin={origin}
            />

            <div className="container mx-auto space-y-40 md:space-y-48 pb-8 px-4 lg:px-0">
              {/* Best Sellers Section */}
              {Boolean(bestSellersSorted?.length) && (
                <BestSellersSection
                  bestSellersProducts={bestSellersProducts || []}
                  origin={origin}
                />
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

        {upsell && !isPromoAlertOpen && (
          <ProductReminderBar
            product={upsell}
            isVisible={showReminderBar && upsell.quantityAvailable > 0}
            onDismiss={() => {
              setShowReminderBar(false);
            }}
            footerRef={footerRef}
          />
        )}
      </div>
    </>
  );
}
