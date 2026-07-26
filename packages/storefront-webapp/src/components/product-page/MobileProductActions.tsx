import { Product, ProductSku, SavedBagItem } from "@athena/webapp";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { ProductActions } from "./ProductActions";

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

export function MobileProductActions({
  handleUpdateBag,
  handleUpdateSavedBag,
  isUpdatingBag,
  savedBagItem,
  isSoldOut,
  addedItemSuccessfully,
}: MobileProductActionsProps) {
  const [isStuck, setIsStuck] = useState(false);
  const [isFooterVisible, setIsFooterVisible] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

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
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className="!mt-layout-sm h-px md:hidden"
        ref={sentinelRef}
      />
      {isStuck && (
        <div
          aria-hidden="true"
          className="!mt-0 md:hidden"
          style={{ height: barHeight }}
        />
      )}
      <motion.div
        animate={{
          opacity: isFooterVisible ? 0 : 1,
          y: isFooterVisible ? 32 : isStuck ? 0 : 4,
          transition: { duration: 0.22, ease: "easeInOut" },
        }}
        className={`z-40 !mt-0 bg-surface/95 px-gutter pb-safe-bottom pt-layout-sm backdrop-blur md:hidden ${
          isFooterVisible ? "pointer-events-none" : ""
        } ${
          isStuck
            ? "fixed inset-x-0 bottom-0 border-t border-border shadow-overlay"
            : "-mx-gutter"
        }`}
        initial={{ opacity: 1, y: 0 }}
        ref={barRef}
      >
        <ProductActions
          addedItemSuccessfully={addedItemSuccessfully}
          className="mx-auto max-w-xl"
          handleUpdateBag={handleUpdateBag}
          handleUpdateSavedBag={handleUpdateSavedBag}
          isSoldOut={isSoldOut}
          isUpdatingBag={isUpdatingBag}
          layout="mobile"
          savedBagItem={savedBagItem}
        />
      </motion.div>
    </>
  );
}
