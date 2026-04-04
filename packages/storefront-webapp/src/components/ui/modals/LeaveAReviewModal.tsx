import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import {
  containerVariants,
  backgroundVariants,
  overlayVariants,
  contentVariants,
} from "./animations/welcomeBackModalAnimations";
import {
  defaultBackgroundImageUrl,
  getModalConfig,
} from "./config/leaveReviewModalConfig";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import {
  createLeaveReviewModalViewedEvent,
  createLeaveReviewModalDismissedEvent,
} from "@/lib/storefrontJourneyEvents";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useQuery } from "@tanstack/react-query";
import { PromoCode } from "./types";
import { LeaveAReviewModalForm } from "./LeaveAReviewModalForm";
import { getPotentialPoints } from "@/components/checkout/utils";
import { useReviewQueries } from "@/lib/queries/reviews";

interface LeaveAReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  promoCode?: PromoCode;
}

export const LeaveAReviewModal: React.FC<LeaveAReviewModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  promoCode,
}) => {
  const onlineOrderQueries = useOnlineOrderQueries();
  const { data: onlineOrders } = useQuery(onlineOrderQueries.list());
  const { hasUserReviewForOrderItem } = useReviewQueries();

  const orderToReview = onlineOrders?.[onlineOrders.length - 1];
  const itemToReview = orderToReview?.items?.[0];
  const { data: hasReviewed } = useQuery(
    hasUserReviewForOrderItem((itemToReview as any)?._id)
  );

  const incentiveType = promoCode ? "discount" : "points";
  const { track } = useStorefrontObservability();

  const hasTrackedView = React.useRef(false);

  React.useEffect(() => {
    if (isOpen && !hasReviewed && !hasTrackedView.current) {
      hasTrackedView.current = true;
      void track(
        createLeaveReviewModalViewedEvent({
          incentiveType,
          promoCodeId: promoCode?.promoCodeId,
        }),
      );
    }
  }, [isOpen, hasReviewed, incentiveType, promoCode?.promoCodeId, track]);

  const handleClose = async (logAnalytics = true) => {
    onClose();

    if (logAnalytics) {
      await track(
        createLeaveReviewModalDismissedEvent({
          incentiveType,
          promoCodeId: promoCode?.promoCodeId,
        }),
      );
    }
  };

  const canReview = ["delivered", "picked-up"].includes(
    orderToReview?.status || ""
  );

  if (
    !isOpen ||
    !orderToReview ||
    hasReviewed ||
    hasReviewed === undefined ||
    !canReview ||
    (!promoCode && orderToReview)
  ) {
    return null;
  }

  const incentiveValue = promoCode
    ? promoCode
    : getPotentialPoints(orderToReview).toLocaleString();

  const currentConfig = getModalConfig(incentiveValue, incentiveType);

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
                <LeaveAReviewModalForm
                  onClose={handleClose}
                  onSuccess={onSuccess}
                  orderToReview={orderToReview}
                  config={currentConfig}
                />
              </motion.div>

              <div className="flex-1" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
};
