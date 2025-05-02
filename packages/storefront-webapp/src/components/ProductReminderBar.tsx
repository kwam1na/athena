import { ProductSku } from "@athena/webapp";
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
  onDismiss: () => void;
  footerRef: React.RefObject<HTMLDivElement>;
}

const COOLDOWN_KEY = "productReminderCooldown";
const COOLDOWN_DURATION = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

export function ProductReminderBar({
  product,
  isVisible,
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
    action: "viewed_product_reminder_bar",
    data: {
      product: product.productId,
      productSku: product.sku,
      productImageUrl: product.images[0],
    },
    isReady: isVisible && !isInCooldown,
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
          origin: "homepage_upsell",
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
      origin: "homepage_upsell",
      data: {
        product: product.productId,
        productSku: product.sku,
        productImageUrl: product.images[0],
      },
    });
  };

  return (
    <>
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTitle />
        <SheetContent>{sheetContent.current}</SheetContent>
      </Sheet>

      <AnimatePresence>
        {isVisible && !isInCooldown && shouldShow && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25,
            }}
            className="fixed bottom-4 inset-x-0 z-10"
          >
            <div className="max-w-[600px] w-[90%] mx-auto">
              <div className="bg-white rounded-lg shadow-md border border-gray-100 p-3 md:p-4">
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
                      <p className="text-xs md:text-sm mt-0.5 md:mt-1 text-muted-foreground">
                        {`👀 Still eyeing this? Only ${product.quantityAvailable} left`}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 md:gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddToBag}
                      disabled={isUpdatingBag}
                    >
                      {isUpdatingBag ? "Adding to Bag.." : "Add to Bag"}
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
