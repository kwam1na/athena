import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatedCard } from "../ui/AnimatedCard";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { StorefrontImage } from "../ui/storefront-image";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import {
  createPromoAlertViewedEvent,
  createPromoAlertDismissedEvent,
  createPromoAlertShopNowEvent,
} from "@/lib/storefrontJourneyEvents";

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
  const { track } = useStorefrontObservability();
  const hasTrackedView = useRef(false);

  useEffect(() => {
    if (isOpen && promoItem && promoItem.productSku && !hasTrackedView.current) {
      hasTrackedView.current = true;
      void track(
        createPromoAlertViewedEvent({
          promoCodeItemId: promoItem._id,
          productSku: promoItem.productSku.sku,
          productImageUrl: promoItem.productSku.images[0],
          productId: promoItem.productSku.productId,
        }),
      );
    }
  }, [isOpen, promoItem, track]);

  const onPromoAlertClose = () => {
    onClose();
    if (promoItem && promoItem.productSku) {
      void track(
        createPromoAlertDismissedEvent({
          promoCodeItemId: promoItem._id,
          productSku: promoItem.productSku.sku,
          productImageUrl: promoItem.productSku.images[0],
          productId: promoItem.productSku.productId,
        }),
      );
    }
  };

  const handleShopNow = () => {
    onClose();
    if (promoItem && promoItem.productSku) {
      void track(
        createPromoAlertShopNowEvent({
          promoCodeItemId: promoItem._id,
          productSkuId: promoItem.productSku._id,
          quantity: promoItem.quantity,
          quantityClaimed: promoItem.quantityClaimed,
        }),
      );
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
      className="fixed left-0 right-0 top-20 z-10 mx-4 max-w-md rounded-card border border-border bg-surface-raised p-layout-md text-foreground shadow-overlay md:mx-auto"
    >
      <div className="relative">
        <IconButton
          label="Close alert"
          onClick={onPromoAlertClose}
          className="absolute right-0 top-0"
          variant="clear"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </IconButton>

        <div className="flex items-center gap-4">
          <StorefrontImage
            src={promoItem.productSku.images[0]}
            alt="Promo item"
            aspectRatio="1 / 1"
            wrapperClassName="w-24 shrink-0 rounded-card"
          />

          <div className="space-y-2">
            <p className="font-medium text-sm">{tagline}</p>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{body}</p>
              <div className="mt-2">
                <Link
                  to="/shop/$categorySlug"
                  params={{ categorySlug: "hair" }}
                  onClick={handleShopNow}
                >
                  <Button variant="outline">
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
