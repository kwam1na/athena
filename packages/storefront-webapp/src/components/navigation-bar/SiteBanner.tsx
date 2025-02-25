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
    return promoCode.discountType === "percentage"
      ? `${value}% OFF`
      : `${formatter.format(value)} OFF`;
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
      className="w-full py-2 flex items-center justify-center"
    >
      <div
        className={cn(
          "flex items-center gap-4 whitespace-nowrap text-xs",
          textClass
        )}
      >
        <p>
          <b>SITEWIDE SALE</b>
        </p>
        <p>
          USE PROMO CODE <b>{activePromoCode.code}</b> FOR{" "}
          <b>{getPromoMessage(activePromoCode)}</b>
        </p>
      </div>
    </motion.div>
  );
};
