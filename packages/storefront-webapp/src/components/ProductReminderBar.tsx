import { Offer, ProductSku, PromoCode } from "@athena/webapp";
import { Button } from "./ui/button";
import { getProductName } from "@/lib/productUtils";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { BagProduct } from "./product-page/ProductDetails";
import { postAnalytics } from "@/api/analytics";
import { useQueryClient } from "@tanstack/react-query";

interface ProductReminderBarProps {
  product: ProductSku;
  isVisible: boolean;
  redeemedOffer?: Offer;
  onDismiss: () => void;
  footerRef: React.RefObject<HTMLDivElement>;
}

const COOLDOWN_KEY = "product_reminder_bar_cooldown";
const COOLDOWN_DURATION = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

export function ProductReminderBar({
  product,
  isVisible,
  redeemedOffer,
  onDismiss,
  footerRef,
}: ProductReminderBarProps) {
  const { addProductToBag, isUpdatingBag, addedItemSuccessfully, bagAction } =
    useShoppingBag();
  const productName = getProductName(product);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isInCooldown, setIsInCooldown] = useState(false);
  const [shouldShow, setShouldShow] = useState(true);
  const sheetContent = useRef<React.ReactNode | null>(null);

  const queryClient = useQueryClient();

  const showReminderBar = isVisible && !isInCooldown && shouldShow;

  const hasDiscountCode =
    redeemedOffer?.promoCode &&
    redeemedOffer?.promoCode?.active &&
    redeemedOffer?.status !== "redeemed";

  useEffect(() => {
    const cooldownUntil = localStorage.getItem(COOLDOWN_KEY);
    if (cooldownUntil && Date.now() < parseInt(cooldownUntil)) {
      setIsInCooldown(true);
      onDismiss();
    }
  }, [onDismiss]);

  useEffect(() => {
    const checkScroll = () => {
      if (footerRef.current) {
        const footerTop = footerRef.current.getBoundingClientRect().top;
        const windowHeight = window.innerHeight;

        // Hide when footer is in view, show when it's not
        setShouldShow(footerTop > windowHeight);
      }
    };

    window.addEventListener("scroll", checkScroll);
    return () => window.removeEventListener("scroll", checkScroll);
  }, [footerRef]);

  const action = hasDiscountCode
    ? "viewed_product_reminder_bar_with_discount_code"
    : "viewed_product_reminder_bar";
  const origin = hasDiscountCode
    ? "homepage_product_reminder_bar_with_discount_code"
    : "homepage_product_reminder_bar";

  useTrackEvent({
    action,
    data: {
      product: product.productId,
      productSku: product.sku,
      productImageUrl: product.images[0],
    },
    isReady: showReminderBar,
  });

  useEffect(() => {
    if (addedItemSuccessfully && product) {
      sheetContent.current = (
        <BagProduct product={product} action={bagAction} />
      );
    }

    const t = setTimeout(() => {
      if (addedItemSuccessfully) {
        setIsSheetOpen(false);
      }
    }, 3500);

    return () => clearTimeout(t);
  }, [addedItemSuccessfully, bagAction, product]);

  const handleAddToBag = async () => {
    if (!product.productId || !product._id || !product.sku) {
      console.error("Missing required product properties");
      return;
    }

    try {
      sheetContent.current = null;

      await Promise.all([
        postAnalytics({
          action: "added_product_to_bag",
          origin,
          data: {
            product: product.productId,
            productSku: product.sku,
            productImageUrl: product.images[0],
          },
        }),
        addProductToBag({
          productId: product.productId,
          productSkuId: product._id,
          productSku: product.sku,
          quantity: 1,
        }),
      ]);

      localStorage.setItem(
        COOLDOWN_KEY,
        (Date.now() + COOLDOWN_DURATION).toString()
      );

      queryClient.invalidateQueries({
        queryKey: ["upsells"],
      });

      setIsSheetOpen(true);
      onDismiss(); // Close the reminder bar after successful add
    } catch (error) {
      console.error("Failed to add to bag:", error);
    }
  };

  const handleDismiss = async () => {
    onDismiss();
    localStorage.setItem(
      COOLDOWN_KEY,
      (Date.now() + COOLDOWN_DURATION).toString()
    );

    await postAnalytics({
      action: "dismissed_product_reminder_bar",
      origin: "homepage_product_reminder_bar",
      data: {
        product: product.productId,
        productSku: product.sku,
        productImageUrl: product.images[0],
      },
    });
  };

  const defaultCTAText = `👀 Still got your eyes on this? ${
    product.quantityAvailable <= 3
      ? `Only ${product.quantityAvailable} left`
      : ""
  }`;

  const promoCodeTitle = `Don't forget your ${redeemedOffer?.promoCode?.displayText} off`;

  const title = hasDiscountCode ? promoCodeTitle : productName;

  const ctaAction = hasDiscountCode ? "Use my offer" : "Add to Bag";

  const withRedeemedPromoCodeCTAText = `Your exclusive discount is still active — don't miss out`;

  const ctaText = hasDiscountCode
    ? withRedeemedPromoCodeCTAText
    : defaultCTAText;

  return (
    <>
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTitle />
        <SheetContent>{sheetContent.current}</SheetContent>
      </Sheet>

      <AnimatePresence>
        {showReminderBar && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { delay: 2.4, ease: "easeInOut", duration: 0.4 },
            }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-4 z-10 inset-x-0 md:inset-x-auto md:right-4 md:w-auto"
          >
            <div className="w-[90%] max-w-[600px] mx-auto">
              <div className="bg-primary/40 backdrop-blur-sm rounded-lg shadow-md border border-none text-white p-3 md:p-4">
                <div className="flex items-center gap-2 md:gap-4">
                  <Link
                    to="/shop/product/$productSlug"
                    params={{ productSlug: product.productId }}
                    search={{
                      variant: product.sku,
                      origin: "product_reminder_bar",
                    }}
                    className="flex flex-1 items-center gap-2 md:gap-4 min-w-0"
                  >
                    <img
                      src={product.images[0]}
                      alt={productName}
                      className="w-10 h-10 md:w-12 md:h-12 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-sm font-medium truncate">{title}</p>
                      <p className="text-xs md:text-sm mt-0.5 md:mt-1">
                        {ctaText}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 md:gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddToBag}
                      disabled={isUpdatingBag}
                    >
                      {ctaAction}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDismiss}
                      className="h-8 w-8 p-0"
                      disabled={isUpdatingBag}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
