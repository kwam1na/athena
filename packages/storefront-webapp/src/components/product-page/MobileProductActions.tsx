import { Product, ProductSku, SavedBagItem } from "@athena/webapp";
import {
  AlertCircleIcon,
  HeartIcon,
  ShoppingBagIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { LoadingButton } from "../ui/loading-button";
import { ProductAttribute } from "./ProductAttribute";

interface MobileProductActionsProps {
  product: Product;
  selectedSku: ProductSku;
  setSelectedSku: (sku: ProductSku) => void;
  handleUpdateBag: () => Promise<void>;
  handleUpdateSavedBag: () => Promise<void>;
  isUpdatingBag: boolean;
  savedBagItem?: SavedBagItem;
  isSoldOut: boolean;
  addedItemSuccessfully: boolean | null;
}

type ProductIntent = "bag" | "save";

export function MobileProductActions({
  product,
  selectedSku,
  setSelectedSku,
  handleUpdateBag,
  handleUpdateSavedBag,
  isUpdatingBag,
  savedBagItem,
  isSoldOut,
  addedItemSuccessfully,
}: MobileProductActionsProps) {
  const [intent, setIntent] = useState<ProductIntent | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  const [isFooterVisible, setIsFooterVisible] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const isExpanded = intent !== null;

  useEffect(() => {
    const updatePosition = () => {
      const sentinel = sentinelRef.current;
      const bar = barRef.current;
      if (!sentinel || !bar) return;

      const nextBarHeight = bar.offsetHeight;
      setBarHeight(nextBarHeight);

      const footer = document.querySelector("footer");
      const footerTop = footer?.getBoundingClientRect().top;
      setIsFooterVisible(
        typeof footerTop === "number" && footerTop <= window.innerHeight,
      );

      const pinLine = window.innerHeight - nextBarHeight;
      setIsStuck(sentinel.getBoundingClientRect().top <= pinLine);
    };

    updatePosition();

    window.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;

    const collapseOnPageClick = (event: PointerEvent) => {
      const bar = barRef.current;
      if (!bar || bar.contains(event.target as Node)) return;

      setIntent(null);
    };

    window.addEventListener("pointerdown", collapseOnPageClick, true);
    return () => {
      window.removeEventListener("pointerdown", collapseOnPageClick, true);
    };
  }, [isExpanded]);

  const colors = Array.from(
    new Set(product.skus.map((sku: any) => sku.colorName).filter(Boolean)),
  );
  const lengths = Array.from(
    new Set(
      product.skus
        .filter((sku: any) => sku.colorName == selectedSku.colorName)
        .map((sku: any) => parseInt(sku.length))
        .filter((length: any) => !isNaN(length)),
    ),
  );
  const sizes = Array.from(
    new Set(
      product.skus
        .map((sku: any) => sku.size)
        .filter((size: any) => size != null && size !== ""),
    ),
  );
  const hasSelectableAttributes = Boolean(
    colors.length ||
      lengths.length ||
      (selectedSku.productCategory !== "Hair" && sizes.length),
  );

  const confirmLabel =
    intent === "save"
      ? savedBagItem
        ? "Remove saved"
        : "Save selection"
      : "Add selection";

  const handleConfirm = async () => {
    if (intent === "save") {
      await handleUpdateSavedBag();
      return;
    }

    await handleUpdateBag();
  };

  const handlePrimaryAction = async () => {
    if (!isExpanded) {
      setIntent("bag");
      return;
    }

    await handleConfirm();
  };

  const handleSecondaryAction = async () => {
    if (!isExpanded) {
      setIntent("save");
      return;
    }

    await handleUpdateSavedBag();
  };

  return (
    <>
      <div
        ref={sentinelRef}
        className="!mt-4 h-px md:hidden"
        aria-hidden="true"
      />
      {isStuck && (
        <div
          className="!mt-0 md:hidden"
          style={{ height: barHeight }}
          aria-hidden="true"
        />
      )}
      <motion.div
        ref={barRef}
        initial={{ opacity: 0, y: 18 }}
        animate={{
          opacity: isFooterVisible ? 0 : 1,
          y: isFooterVisible ? 32 : isStuck ? 0 : 4,
          transition: { duration: 0.22, ease: "easeInOut" },
        }}
        className={`z-40 !mt-0 bg-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 md:hidden ${
          isFooterVisible ? "pointer-events-none" : ""
        } ${
          isStuck
            ? "fixed inset-x-0 bottom-0 shadow-none"
            : "-mx-6 shadow-none"
        }`}
      >
        <div className="mx-auto max-w-[600px] space-y-4">
          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                key="mobile-product-variant-selector"
                initial={{ height: 0, opacity: 0 }}
                animate={{
                  height: "auto",
                  opacity: 1,
                  transition: { ease: "easeInOut", duration: 0.22 },
                }}
                exit={{
                  height: 0,
                  opacity: 0,
                  transition: { ease: "easeInOut", duration: 0.18 },
                }}
                className="overflow-hidden"
                onClick={() => setIntent(null)}
              >
                <div
                  className="space-y-4 pb-1"
                  role="button"
                  tabIndex={0}
                  aria-label="Collapse product options"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setIntent(null);
                    }
                  }}
                >
                  <div onClick={(event) => event.stopPropagation()}>
                  <ProductAttribute
                    product={product}
                    selectedSku={selectedSku}
                    setSelectedSku={setSelectedSku}
                    density="compact"
                  />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-3">
            <LoadingButton
              className="h-12 min-w-0 flex-1 px-4 text-sm"
              isLoading={intent === "bag" && isUpdatingBag}
              onClick={handlePrimaryAction}
              disabled={isSoldOut}
              data-testid="storefront-product-add-to-bag"
            >
              {isExpanded
                ? confirmLabel
                : isUpdatingBag
                  ? "Adding to Bag.."
                  : "Add to Bag"}
            </LoadingButton>

            <LoadingButton
              type="button"
              variant="outline"
              isLoading={isExpanded && intent === "save" && isUpdatingBag}
              onClick={handleSecondaryAction}
              disabled={isSoldOut}
              aria-label={
                isExpanded && intent === "save"
                  ? "Add selection to bag"
                  : savedBagItem
                    ? "Saved"
                    : "Save product"
              }
              className={`h-12 w-14 shrink-0 px-0 ${
                savedBagItem ? "border-[#EC4683] shadow-md" : ""
              } hover:shadow-md`}
            >
              {isExpanded && intent === "save" ? (
                <ShoppingBagIcon className="h-5 w-5 text-muted-foreground" />
              ) : (
                <>
                  {!savedBagItem && (
                    <HeartIcon className="h-5 w-5 text-muted-foreground" />
                  )}
                  {savedBagItem && <HeartIconFilled width={18} height={18} />}
                </>
              )}
            </LoadingButton>
          </div>

          {addedItemSuccessfully === false && (
            <div className="flex items-center gap-1 text-destructive">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              <p className="text-sm">
                An error occurred processing your last request
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
