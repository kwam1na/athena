import { useUserOffersQueries } from "@/lib/queries/userOffers";
import { useModalState } from "./useModalState";
import { useQuery } from "@tanstack/react-query";

const DISCOUNT_CODE_ALERT_COOLDOWN_DAYS = 30;
const DISCOUNT_CODE_ALERT_LAST_SHOWN_KEY = "discount_code_alert_last_shown";
const DISCOUNT_CODE_ALERT_COMPLETED_KEY = "discount_code_alert_completed";
const DISCOUNT_CODE_ALERT_DISMISSED_KEY = "discount_code_alert_dismissed";

/**
 * Custom hook to handle discount code alert logic for the welcome back modal
 * Uses the generic useModalState hook for state management and checks eligibility
 */
export function useDiscountCodeAlert() {
  const {
    isOpen,
    setIsOpen,
    hasBeenShown,
    setHasBeenShown,
    isDismissed,
    setIsDismissed,
    lastShownTime,
    isLoaded,
    handleOpen,
    handleClose,
    handleSuccess,
    completeFlow,
    hasCompleted,
  } = useModalState({
    cooldownDays: DISCOUNT_CODE_ALERT_COOLDOWN_DAYS,
    lastShownKey: DISCOUNT_CODE_ALERT_LAST_SHOWN_KEY,
    completedKey: DISCOUNT_CODE_ALERT_COMPLETED_KEY,
    dismissedKey: DISCOUNT_CODE_ALERT_DISMISSED_KEY,
  });

  const offersQueries = useUserOffersQueries();

  const { data: redeemedOffers } = useQuery(offersQueries.redeemed());

  return {
    isDiscountModalOpen: isOpen,
    setIsDiscountModalOpen: setIsOpen,
    hasDiscountModalBeenShown:
      hasBeenShown || (redeemedOffers?.length ?? 0) > 0,
    setHasDiscountModalBeenShown: setHasBeenShown,
    isDiscountModalDismissed: isDismissed,
    setIsDiscountModalDismissed: setIsDismissed,
    lastDiscountModalShownTime: lastShownTime,
    isDiscountModalStateLoaded: isLoaded,
    openDiscountModal: handleOpen,
    handleCloseDiscountModal: handleClose,
    handleSuccessDiscountModal: handleSuccess,
    completeDiscountModalFlow: completeFlow,
    hasCompletedDiscountModalFlow: hasCompleted,
    hasRedeemedOffers: redeemedOffers?.some(
      (offer: any) => offer.status === "redeemed"
    ),
    redeemedOffers,
  };
}
