import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { useStoreContext } from "@/contexts/StoreContext";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { cn } from "@/lib/utils";
import { PromoCode } from "@athena/webapp";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

export const SiteBanner = () => {
  const { navBarLayout, appLocation } = useNavigationBarContext();
  const { formatter } = useStoreContext();
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoCodes } = useQuery(promoCodeQueries.getAll());

  const textClass =
    navBarLayout == "sticky" && appLocation == "homepage" ? "text-white" : "";

  const getPromoMessage = (promoCode: PromoCode) => {
    if (!promoCode) return "";
    const value = promoCode.discountValue;

    if (promoCode.discountType === "percentage") {
      return promoCode.span === "selected-products"
        ? `${value}% off select items`
        : `up to 20% off`;
    } else {
      return promoCode.span === "selected-products"
        ? `${formatter.format(value)} off select items`
        : `${formatter.format(value)} off`;
    }
  };

  const activePromoCode = promoCodes?.find((code) => code.active);

  if (!activePromoCode) return null;

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
      <div
        className={cn(
          "flex items-center whitespace-nowrap text-xs",
          "md:justify-center",
          "max-md:w-max max-md:gap-8 max-md:animate-scroll max-md:hover:animate-pause"
        )}
      >
        {[...Array(2)].map((_, idx) => (
          <div
            key={idx}
            className={cn(
              "flex gap-4",
              "md:hidden" // Hide duplicates on medium screens and up
            )}
          >
            <p>
              <b>SITEWIDE SALE</b>
            </p>
            <p className="uppercase">
              promo code <b>{activePromoCode.code}</b> automatically applied for{" "}
              <b>{getPromoMessage(activePromoCode).toUpperCase()}</b>
            </p>
          </div>
        ))}
        {/* Single centered content for medium screens and up */}
        <div className="hidden md:flex md:gap-4">
          <p>
            <b>SITEWIDE SALE</b>
          </p>
          <p className="uppercase">
            promo code <b>{activePromoCode.code}</b> automatically applied for{" "}
            <b>{getPromoMessage(activePromoCode).toUpperCase()}</b>
          </p>
        </div>
      </div>
    </motion.div>
  );
};
