import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { useStoreContext } from "@/contexts/StoreContext";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useBannerMessageQueries } from "@/lib/queries/bannerMessage";
import { cn } from "@/lib/utils";
import { PromoCode, BannerMessage } from "@athena/webapp";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

export const SiteBanner = () => {
  const { navBarLayout, appLocation } = useNavigationBarContext();
  const { formatter } = useStoreContext();
  const promoCodeQueries = usePromoCodesQueries();
  const bannerMessageQueries = useBannerMessageQueries();
  const { data: promoCodes } = useQuery(promoCodeQueries.getAll());
  const { data: bannerMessage } = useQuery(bannerMessageQueries.get());

  const textClass =
    navBarLayout == "sticky" && appLocation == "homepage" ? "text-white" : "";

  const getPromoMessage = (promoCode: PromoCode) => {
    if (!promoCode) return "";
    const value = promoCode.discountValue;

    if (promoCode.discountType === "percentage") {
      return promoCode.span === "selected-products"
        ? `${value}% off select items`
        : `up to ${value}% off`;
    } else {
      return promoCode.span === "selected-products"
        ? `${formatter.format(value)} off select items`
        : `${formatter.format(value)} off`;
    }
  };

  // Check for active banner message first (takes precedence)
  const hasActiveBannerMessage = bannerMessage?.active === true;

  // Fall back to promo code if no active banner message
  const activePromoCode = !hasActiveBannerMessage
    ? promoCodes?.find((code) => code.active && code.sitewide)
    : undefined;

  // Return null if neither banner message nor promo code is active
  if (!hasActiveBannerMessage && !activePromoCode) return null;

  return (
    <motion.div
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        duration: 1.4,
        delay: appLocation == "homepage" ? 1.85 : 0,
        ease: "easeInOut",
      }}
      className={`w-full py-2 overflow-hidden ${textClass}`}
    >
      <div className="flex items-center whitespace-nowrap text-xs md:justify-center">
        {/* Scrolling content for mobile */}
        <div className="md:hidden flex animate-scroll hover:animate-pause">
          {hasActiveBannerMessage && bannerMessage ? (
            <>
              {[...Array(3)].map((_, idx) => (
                <div key={idx} className="flex gap-4 px-4">
                  {bannerMessage.heading && (
                    <p>
                      <b>{bannerMessage.heading.toUpperCase()}</b>
                    </p>
                  )}
                  {bannerMessage.message && (
                    <p className="uppercase">{bannerMessage.message}</p>
                  )}
                </div>
              ))}
            </>
          ) : (
            activePromoCode && (
              <>
                {[...Array(3)].map((_, idx) => (
                  <div key={idx} className="flex gap-4 px-4">
                    <p>
                      <b>SITEWIDE SALE</b>
                    </p>
                    <p className="uppercase">
                      promo code <b>{activePromoCode.code}</b>{" "}
                      {activePromoCode.autoApply ? "automatically applied" : ""}{" "}
                      for{" "}
                      <b>{getPromoMessage(activePromoCode).toUpperCase()}</b>
                    </p>
                  </div>
                ))}
              </>
            )
          )}
        </div>

        {/* Single centered content for medium screens and up */}
        {hasActiveBannerMessage && bannerMessage ? (
          <div className="hidden md:flex md:gap-4">
            {bannerMessage.heading && (
              <p>
                <b>{bannerMessage.heading.toUpperCase()}</b>
              </p>
            )}
            {bannerMessage.message && (
              <p className="uppercase">{bannerMessage.message}</p>
            )}
          </div>
        ) : (
          activePromoCode && (
            <div className="hidden md:flex md:gap-4">
              <p>
                <b>SITEWIDE SALE</b>
              </p>
              <p className="uppercase">
                promo code <b>{activePromoCode.code}</b> automatically applied
                for <b>{getPromoMessage(activePromoCode).toUpperCase()}</b>
              </p>
            </div>
          )
        )}
      </div>
    </motion.div>
  );
};
