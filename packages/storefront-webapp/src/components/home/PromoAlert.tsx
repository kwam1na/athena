import { Dispatch, SetStateAction, useRef } from "react";
import { X } from "lucide-react";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../ui/button";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { postAnalytics } from "@/api/analytics";

interface PromoAlertProps {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
}

export function PromoAlert({ isOpen, setIsOpen }: PromoAlertProps) {
  const alertRef = useRef<HTMLDivElement>(null);
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoItems } = useQuery(promoCodeQueries.getAllItems());
  const promoItem = promoItems?.[0];

  // Track when the alert is viewed
  useTrackEvent({
    action: "viewed_promo_alert",
    data: {
      promoCodeItemId: promoItem?._id,
      productSku: promoItem?.productSku.sku,
      productImageUrl: promoItem?.productSku.images[0],
      product: promoItem?.productSku.productId,
    },
    isReady: isOpen && !!promoItem && !!promoItem.productSku,
  });

  const onClose = () => {
    setIsOpen(false);
    localStorage.setItem("promo_alert_last_shown", Date.now().toString());
    if (promoItem && promoItem.productSku) {
      postAnalytics({
        action: "dismissed_promo_alert",
        origin: "promo_alert",
        data: {
          promoCodeItemId: promoItem._id,
          productSku: promoItem.productSku.sku,
          productImageUrl: promoItem.productSku.images[0],
          product: promoItem.productSku.productId,
        },
      });
    }
  };

  // Track when the alert is actioned on
  const handleShopNow = () => {
    setIsOpen(false);
    localStorage.setItem("promo_alert_last_shown", Date.now().toString());
    if (promoItem && promoItem.productSku) {
      postAnalytics({
        action: "clicked_shop_all_hair",
        origin: "promo_alert",
        data: {
          promoCodeItemId: promoItem._id,
          productSkuId: promoItem.productSku._id,
          quantity: promoItem.quantity,
          quantityClaimed: promoItem.quantityClaimed,
        },
      });
    }
  };

  if (!promoItem || !promoItem.productSku) return null;

  // Calculate how many items are left
  const itemsLeft =
    promoItem.quantity && promoItem.quantityClaimed
      ? promoItem.quantity - promoItem.quantityClaimed
      : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={alertRef}
          initial={{ opacity: 0, y: -50 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: {
              duration: 0.8,
              delay: 2.8,
              ease: [0.22, 1, 0.36, 1],
            },
          }}
          exit={{
            opacity: 0,
            y: -50,
            transition: {
              duration: 0.4,
              ease: [0.4, 0, 1, 1],
            },
          }}
          className="fixed top-[80px] left-0 right-0 z-10 mx-auto max-w-md border rounded-md p-4 px-6 md:px-4 mx-4 md:mx-auto shadow-lg transition-colors duration-300 bg-black/30 backdrop-blur-sm border-white/20"
        >
          <div className="relative">
            <button
              onClick={onClose}
              className="absolute right-0 top-0 text-white"
              aria-label="Close alert"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-4">
              <img
                src={promoItem.productSku.images[0]}
                alt="Promo item"
                className="w-24 h-24 rounded-md object-cover"
              />

              <div className="space-y-2">
                <p className="font-medium text-sm text-white">
                  Almost Gone! Only {itemsLeft} left
                </p>
                <div className="space-y-4">
                  <p className="text-sm text-white/80">
                    Our free gift promotion is almost over. Shop now to claim
                    yours!
                  </p>
                  <div className="mt-2">
                    <Link
                      to="/shop/$categorySlug"
                      params={{ categorySlug: "hair" }}
                      onClick={handleShopNow}
                    >
                      <Button
                        variant="outline"
                        className="bg-white text-black hover:bg-white/90 border-transparent"
                      >
                        Shop Now
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
