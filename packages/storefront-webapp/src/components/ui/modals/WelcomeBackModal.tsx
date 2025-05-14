import React, { useState } from "react";
import { motion } from "framer-motion";
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
import { useQuery } from "@tanstack/react-query";

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

  // Get or initialize the variant once, persisting it in localStorage
  const [selectedVariant] = useState(() => {
    // Try to get from localStorage first
    const storedVariant = localStorage.getItem(WELCOME_VARIANT_KEY);

    if (storedVariant !== null) {
      const parsed = parseInt(storedVariant, 10);
      // Validate the stored value
      if (!isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    // Only generate a random variant if none exists in storage
    const maxIndex =
      Math.min(welcomeBackConfigs.length, nextOrderConfigs.length) - 1;
    const newVariant = Math.floor(Math.random() * (maxIndex + 1));
    localStorage.setItem(WELCOME_VARIANT_KEY, newVariant.toString());
    return newVariant;
  });

  // Choose the appropriate config based on order status
  const configsArray = isNextOrder ? nextOrderConfigs : welcomeBackConfigs;
  // Ensure the variant is valid for the current config array
  const safeVariant = Math.min(selectedVariant, configsArray.length - 1);
  const currentConfig = configsArray[safeVariant];

  useTrackEvent({
    action: "viewed_WELCOMEBACK25_modal",
    isReady: isOpen,
    data: {
      isNextOrder,
      selectedVariant: safeVariant,
    },
  });

  const handleClose = async (logAnalytics = true) => {
    // Reset state when closing
    setIsSuccess(false);
    onClose();

    if (logAnalytics) {
      await postAnalytics({
        action: "dismissed_WELCOMEBACK25_modal",
        data: {
          isNextOrder,
          selectedVariant: safeVariant,
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

    await postAnalytics({
      action: "submitted_WELCOMEBACK25_modal",
      data: {
        isNextOrder,
        selectedVariant: safeVariant,
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
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
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
          animate="visible"
          className="absolute inset-0 z-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${currentConfig.backgroundImageUrl || defaultBackgroundImageUrl})`,
          }}
        />

        {/* Frosted Glass Overlay */}
        <motion.div
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          className="absolute inset-0 z-0"
        />

        {/* Content */}
        <div className="relative z-10 p-4 sm:p-6 flex flex-col items-center justify-between w-full max-w-[90%] sm:max-w-full mx-auto text-white h-full">
          <div className="flex-1" />

          <motion.div
            variants={contentVariants}
            initial="hidden"
            animate="visible"
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
    </Modal>
  );
};
