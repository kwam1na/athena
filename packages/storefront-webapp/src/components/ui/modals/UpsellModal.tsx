import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import { WelcomeBackModalForm } from "./WelcomeBackModalForm";
import { WelcomeBackModalSuccess } from "./WelcomeBackModalSuccess";
import {
  containerVariants,
  backgroundVariants,
  overlayVariants,
  contentVariants,
} from "./animations/welcomeBackModalAnimations";
import {
  welcomeBackConfigs,
  defaultBackgroundImageUrl,
  nextOrderConfigs,
  getModalConfig,
} from "./config/welcomeBackModalConfig";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { postAnalytics } from "@/api/analytics";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUpsellsQueries } from "@/lib/queries/upsells";
import { UpsellModalForm } from "./UpsellModalForm";
import { PromoCode } from "./types";
import { useUpsellModal } from "@/hooks/useUpsellModal";
import { UpsellModalSuccess } from "./UpsellModalSuccess";

interface UpsellModalProps {
  promoCode?: PromoCode;
}

export const UpsellModal: React.FC<UpsellModalProps> = ({ promoCode }) => {
  const [isSuccess, setIsSuccess] = useState(false);

  const onlineOrderQueries = useOnlineOrderQueries();
  const { data: onlineOrders } = useQuery(onlineOrderQueries.list());

  const upsellsQueries = useUpsellsQueries({ category: "Hair" });
  const { data: upsell } = useQuery(upsellsQueries.upsells());

  const {
    isUpsellModalOpen,
    setIsUpsellModalOpen,
    hasUpsellModalBeenShown,
    handleCloseUpsellModal,
    completeUpsellModalFlow,
    isUpsellModalStateLoaded,
    setHasUpsellModalBeenShown,
    isUpsellModalDismissed,
  } = useUpsellModal();

  const [hasScrolledPastThreshold, setHasScrolledPastThreshold] =
    useState(false);

  const isNextOrder = onlineOrders?.length > 1;

  useEffect(() => {
    // Don't add scroll listener until localStorage state is fully loaded
    if (!isUpsellModalStateLoaded) return;

    const handleScroll = () => {
      const scrollPosition = window.scrollY;

      // Check if user has scrolled past the threshold and the modal hasn't been shown yet
      if (
        scrollPosition > window.innerHeight * 0.6 &&
        !hasScrolledPastThreshold &&
        !hasUpsellModalBeenShown &&
        !isUpsellModalDismissed // Also check if it was dismissed
      ) {
        setHasScrolledPastThreshold(true);
        setIsUpsellModalOpen(true);
        setHasUpsellModalBeenShown(true);
      }
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [
    hasScrolledPastThreshold,
    hasUpsellModalBeenShown,
    isUpsellModalDismissed,
    isUpsellModalStateLoaded,
  ]);

  useTrackEvent({
    action: "viewed_upsell_product_modal",
    isReady: isUpsellModalOpen,
    data: {
      isNextOrder,
      promoCodeId: promoCode?.promoCodeId,
      product: upsell?.productId,
      productSku: upsell?.sku,
      productImageUrl: upsell?.images[0],
    },
  });

  const handleClose = async (logAnalytics = true) => {
    handleCloseUpsellModal();

    // Log analytics if needed
    if (logAnalytics) {
      await postAnalytics({
        action: "dismissed_upsell_product_modal",
        data: {
          isNextOrder,
          promoCodeId: promoCode?.promoCodeId,
          product: upsell?.productId,
          productSku: upsell?.sku,
          productImageUrl: upsell?.images[0],
        },
      });
    }
  };

  const handleSuccess = async () => {
    completeUpsellModalFlow();

    await postAnalytics({
      action: "submitted_upsell_product_modal",
      data: {
        isNextOrder,
        promoCodeId: promoCode?.promoCodeId,
        product: upsell?.productId,
        productSku: upsell?.sku,
        productImageUrl: upsell?.images[0],
      },
    });

    setIsSuccess(true);
  };

  if (!promoCode || !isUpsellModalOpen || !upsell) {
    return null;
  }

  const modalType = isNextOrder ? "nextOrder" : "welcomeBack";
  const currentConfig = getModalConfig(promoCode, modalType);

  return (
    <Modal
      isOpen={isUpsellModalOpen}
      onClose={handleClose}
      title=""
      withoutBackground
      fullscreen
      wideOnDesktop
    >
      <AnimatePresence mode="wait">
        {isUpsellModalOpen && (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate={"visible"}
            className="relative flex flex-col items-center justify-center text-center overflow-y-auto h-full w-full sm:rounded-lg"
          >
            {isSuccess ? (
              // Success state - centered layout with background
              <div className="flex flex-col sm:flex-row w-full h-full">
                {/* Background Image */}
                <motion.div
                  variants={backgroundVariants}
                  initial="hidden"
                  animate={"visible"}
                  className="w-full sm:w-1/2 h-[50%] sm:h-auto sm:min-h-full bg-cover bg-center flex-shrink-0"
                  style={{
                    backgroundImage: `url(${upsell?.images[0]})`,
                  }}
                />

                {/* Content */}
                <motion.div
                  variants={contentVariants}
                  initial="hidden"
                  animate={"visible"}
                  className="w-full sm:w-1/2 bg-accent2/20 backdrop-blur-2xl flex flex-col items-center justify-center p-6 sm:p-8 relative sm:min-h-full h-full"
                >
                  <UpsellModalSuccess
                    onClose={() => handleClose(false)}
                    upsell={upsell}
                  />
                </motion.div>
              </div>
            ) : (
              // Form state - stacked on mobile, side by side on desktop
              <div className="flex flex-col sm:flex-row w-full min-h-full">
                {/* Top/Left side - Image */}
                <motion.div
                  variants={backgroundVariants}
                  initial="hidden"
                  animate={"visible"}
                  className="w-full sm:w-1/2 h-[50%] sm:h-auto sm:min-h-full bg-cover bg-center flex-shrink-0"
                  style={{
                    backgroundImage: `url(${upsell?.images[0]})`,
                  }}
                />

                {/* Bottom/Right side - Form with background */}
                <motion.div
                  variants={contentVariants}
                  initial="hidden"
                  animate={"visible"}
                  className="w-full sm:w-1/2 bg-accent2/20 backdrop-blur-2xl flex flex-col items-center justify-center p-6 sm:p-8 relative sm:min-h-full h-full"
                >
                  {/* Gradient overlay from left edge */}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/30 via-black/10 to-transparent pointer-events-none" />
                  <div className="relative z-10 w-full max-w-md mx-auto">
                    <UpsellModalForm
                      upsell={upsell}
                      onClose={handleClose}
                      onSuccess={handleSuccess}
                      promoCode={promoCode}
                      config={currentConfig}
                    />
                  </div>
                </motion.div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
};
