import { ProductSku, PromoCode } from "@athena/webapp";
import { Button } from "./ui/button";
import { getProductName } from "@/lib/productUtils";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { BagProduct } from "./product-page/ProductDetails";
import { postAnalytics } from "@/api/analytics";
import { useQueryClient } from "@tanstack/react-query";

interface ProductActionBarProps {
  product: ProductSku;
  isVisible: boolean;
  onDismiss: () => void;
  promoCode?: PromoCode;
  footerRef: React.RefObject<HTMLDivElement>;
}

const COOLDOWN_KEY = "product_action_bar_cooldown";
const COOLDOWN_DURATION = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

export function ProductActionBar({
  product,
  isVisible,
  onDismiss,
  footerRef,
  promoCode,
}: ProductActionBarProps) {
  const productName = getProductName(product);
  const [isInCooldown, setIsInCooldown] = useState(false);
  const [shouldShow, setShouldShow] = useState(true);

  const showReminderBar = isVisible && !isInCooldown && shouldShow;

  const navigate = useNavigate();

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

  useTrackEvent({
    action: "viewed_product_action_bar",
    data: {
      product: product.productId,
      productSku: product.sku,
      productImageUrl: product.images[0],
    },
    isReady: showReminderBar,
  });

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

  const handleAction = () => {
    navigate({
      to: "/shop/bag",
    });
  };

  return (
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
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {productName}
                    </p>
                    {promoCode && (
                      <p className="text-xs md:text-sm mt-0.5 md:mt-1">
                        {`Don't miss out on your ${promoCode.displayText} offer. Auto-applied at checkout.`}
                      </p>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-1 md:gap-2">
                  <Button size="sm" onClick={handleAction}>
                    View Bag
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDismiss}
                    className="h-8 w-8 p-0"
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
  );
}
