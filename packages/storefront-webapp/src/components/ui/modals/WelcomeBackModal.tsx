import React, { useState, useRef } from "react";
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
} from "./config/welcomeBackModalConfig";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { postAnalytics } from "@/api/analytics";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface WelcomeBackModalProps {
  isOpen: boolean;
  onClose: () => void;
  promoCodeId?: string;
  onSuccess?: () => void;
}

// Single storage key for variant persistence
const WELCOME_VARIANT_KEY = "welcome_modal_variant";

export const WelcomeBackModal: React.FC<WelcomeBackModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  promoCodeId,
}) => {
  const [isSuccess, setIsSuccess] = useState(false);

  const onlineOrderQueries = useOnlineOrderQueries();
  const { data: onlineOrders } = useQuery(onlineOrderQueries.list());

  const isNextOrder = onlineOrders?.length > 1;

  const configsArray = isNextOrder ? nextOrderConfigs : welcomeBackConfigs;

  const safeVariant = 1;
  const currentConfig = configsArray[safeVariant];

  useTrackEvent({
    action: "viewed_WELCOMEBACK25_modal",
    isReady: isOpen,
    data: {
      isNextOrder,
      selectedVariant: safeVariant,
      promoCodeId,
    },
  });

  const handleClose = async (logAnalytics = true) => {
    onClose();

    // Log analytics if needed
    if (logAnalytics) {
      await postAnalytics({
        action: "dismissed_WELCOMEBACK25_modal",
        data: {
          isNextOrder,
          selectedVariant: safeVariant,
          promoCodeId,
        },
      });
    }
  };

  const handleSuccess = async () => {
    setIsSuccess(true);
    // Call the onSuccess callback if provided
    if (onSuccess) {
      onSuccess();
    }

    // await queryClient.invalidateQueries({
    //   queryKey: ["userOffers", "redeemed"],
    // });

    await postAnalytics({
      action: "submitted_WELCOMEBACK25_modal",
      data: {
        isNextOrder,
        selectedVariant: safeVariant,
        promoCodeId,
      },
    });
  };

  if (!promoCodeId || !isOpen) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title=""
      withoutHeader
      withoutCloseButton
      withoutBackground
      fullscreen
    >
      <AnimatePresence mode="wait">
        {isOpen && (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate={"visible"}
            className="relative flex flex-col items-center justify-center text-center overflow-hidden w-full h-full sm:rounded-lg"
            style={{
              height: "100%",
              width: "100%",
            }}
          >
            {/* Background Image */}
            <motion.div
              variants={backgroundVariants}
              initial="hidden"
              animate={"visible"}
              className="absolute inset-0 z-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${currentConfig.backgroundImageUrl || defaultBackgroundImageUrl})`,
              }}
            />

            {/* Frosted Glass Overlay */}
            <motion.div
              variants={overlayVariants}
              initial="hidden"
              animate={"visible"}
              className="absolute inset-0 z-0"
            />

            {/* Content */}
            <div className="relative z-10 p-4 sm:p-6 flex flex-col items-center justify-between w-full max-w-[90%] sm:max-w-full mx-auto text-white h-full">
              <div className="flex-1" />

              <motion.div
                variants={contentVariants}
                initial="hidden"
                animate={"visible"}
                className="flex flex-col items-center"
              >
                {isSuccess ? (
                  <WelcomeBackModalSuccess onClose={() => handleClose(false)} />
                ) : (
                  <WelcomeBackModalForm
                    onClose={handleClose}
                    onSuccess={handleSuccess}
                    promoCodeId={promoCodeId}
                    config={currentConfig}
                  />
                )}
              </motion.div>

              <div className="flex-1" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
};
