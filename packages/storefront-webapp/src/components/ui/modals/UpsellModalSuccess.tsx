import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  successVariants,
  checkIconVariants,
} from "./animations/welcomeBackModalAnimations";
import { getProductName } from "@/lib/utils";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { postAnalytics } from "@/api/analytics";
import { useNavigate } from "@tanstack/react-router";

interface UpsellModalSuccessProps {
  upsell: any;
  onClose: () => void;
}

export const UpsellModalSuccess: React.FC<UpsellModalSuccessProps> = ({
  onClose,
  upsell,
}) => {
  const { addProductToBag, bag } = useShoppingBag();
  const [isAddingToBag, setIsAddingToBag] = useState(false);

  const navigate = useNavigate();

  const isItemInBag = bag?.items.find((item) => item.productSku === upsell.sku);

  const handleAddToBag = async () => {
    setIsAddingToBag(true);

    if (!isItemInBag) {
      await Promise.allSettled([
        await addProductToBag({
          productId: upsell.productId,
          productSkuId: upsell._id,
          productSku: upsell.sku,
          quantity: 1,
        }),

        await postAnalytics({
          action: "added_product_to_bag",
          origin: "homepage_upsell_modal",
          data: {
            product: upsell.productId,
            productSku: upsell.sku,
            productImageUrl: upsell.images[0],
          },
        }),
      ]);
    }

    navigate({
      to: "/shop/bag",
    });

    setIsAddingToBag(false);

    onClose();
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="success-content"
        variants={successVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="flex flex-col items-center gap-6 text-white"
      >
        <motion.div
          variants={checkIconVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="bg-white/20 backdrop-blur-md rounded-full p-4"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </motion.div>
        <p>Your discount code will automatically be applied during checkout</p>
        <Button
          onClick={handleAddToBag}
          className="mt-4 font-semibold py-2 sm:py-3 rounded"
          disabled={isAddingToBag}
        >
          {isItemInBag
            ? `View ${getProductName(upsell)} in your bag`
            : `Add ${getProductName(upsell)} to your bag`}
        </Button>
      </motion.div>
    </AnimatePresence>
  );
};
