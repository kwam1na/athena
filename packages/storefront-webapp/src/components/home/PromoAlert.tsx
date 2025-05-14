import { Dispatch, SetStateAction, useRef } from "react";
import { X } from "lucide-react";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatedCard } from "../ui/AnimatedCard";
import { Button } from "../ui/button";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { postAnalytics } from "@/api/analytics";

interface PromoAlertProps {
  isOpen: boolean;
  onClose: () => void;
}

function getPromoAlertCopy(itemsLeft: number) {
  if (itemsLeft <= 0) {
    return {
      tagline: "All gifts claimed!",
      body: "Thanks for the love! Our complimentary mini straightener (GHS 180 value) is all gone — stay tuned for the next drop!",
    };
  } else if (itemsLeft <= 2) {
    return {
      tagline: `Last chance — only ${itemsLeft} left!`,
      body: "Final chance to score a complimentary mini straightener (GHS 180 value) with your purchase.",
    };
  } else if (itemsLeft <= 5) {
    return {
      tagline: `Almost gone — only ${itemsLeft} left!`,
      body: "Hurry! Grab your complimentary mini straightener (GHS 180 value) before they're all claimed.",
    };
  } else if (itemsLeft <= 10) {
    return {
      tagline: `Going fast — only ${itemsLeft} left!`,
      body: "Act now to get a complimentary mini straightener (GHS 180 value) with your purchase.",
    };
  } else if (itemsLeft <= 20) {
    return {
      tagline: `Hurry — only ${itemsLeft} left!`,
      body: "Limited stock. Secure your complimentary mini straightener (GHS 180 value) today.",
    };
  } else if (itemsLeft <= 39) {
    return {
      tagline: `Moving fast — only ${itemsLeft} left!`,
      body: "Claim your complimentary mini straightener (GHS 180 value) while supplies last.",
    };
  } else {
    return {
      tagline: "Limited-time free gift!",
      body: "Score a complimentary mini straightener (GHS 180 value) with your purchase while supplies last.",
    };
  }
}

export function PromoAlert({ isOpen, onClose }: PromoAlertProps) {
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoItems } = useQuery(promoCodeQueries.getAllItems());
  const promoItem = promoItems?.[0];

  // Track when the alert is viewed
  useTrackEvent({
    action: "viewed_promo_alert",
    data: {
      promoCodeItemId: promoItem?._id,
      productSku: promoItem?.productSku?.sku,
      productImageUrl: promoItem?.productSku?.images[0],
      product: promoItem?.productSku?.productId,
    },
    isReady: isOpen && !!promoItem && !!promoItem.productSku,
  });

  const onPromoAlertClose = () => {
    onClose();
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
    onClose();
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

  const { tagline, body } = getPromoAlertCopy(itemsLeft);

  return (
    <AnimatedCard
      isOpen={isOpen}
      className="fixed top-[80px] left-0 right-0 z-10 max-w-md border rounded-md p-4 px-6 mx-4 md:mx-auto shadow-lg transition-colors duration-300 bg-black/30 backdrop-blur-sm border-white/20"
    >
      <div className="relative">
        <button
          onClick={onPromoAlertClose}
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
            <p className="font-medium text-sm text-white">{tagline}</p>
            <div className="space-y-4">
              <p className="text-sm text-white/80">{body}</p>
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
    </AnimatedCard>
  );
}
