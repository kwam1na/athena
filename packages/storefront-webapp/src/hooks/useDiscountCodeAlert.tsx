import { useModalState } from "./useModalState";
import { useUserOffersQueries } from "@/lib/queries/userOffers";
import { useQuery } from "@tanstack/react-query";

const WELCOME_BACK_MODAL_COOLDOWN_DAYS = 30;
const WELCOME_BACK_MODAL_LAST_SHOWN_KEY = "welcome_back_modal_last_shown";
const WELCOME_BACK_MODAL_COMPLETED_KEY = "welcome_back_modal_completed";
const WELCOME_BACK_MODAL_DISMISSED_KEY = "welcome_back_modal_dismissed";

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
    handleOpen,
    handleClose,
    handleSuccess,
    completeFlow,
    hasCompleted,
  } = useModalState({
    cooldownDays: WELCOME_BACK_MODAL_COOLDOWN_DAYS,
    lastShownKey: WELCOME_BACK_MODAL_LAST_SHOWN_KEY,
    completedKey: WELCOME_BACK_MODAL_COMPLETED_KEY,
    dismissedKey: WELCOME_BACK_MODAL_DISMISSED_KEY,
  });

  // Get eligibility data using the query
  const userOffersQueries = useUserOffersQueries();
  const { data: eligibility } = useQuery(userOffersQueries.eligibility());
  const isEligibleForWelcome25 = eligibility?.isEligibleForWelcome25 || false;

  return {
    isDiscountModalOpen: isOpen && isEligibleForWelcome25,
    setIsDiscountModalOpen: setIsOpen,
    hasDiscountModalBeenShown: hasBeenShown,
    setHasDiscountModalBeenShown: setHasBeenShown,
    isDiscountModalDismissed: isDismissed,
    setIsDiscountModalDismissed: setIsDismissed,
    lastDiscountModalShownTime: lastShownTime,
    openDiscountModal: handleOpen,
    handleCloseDiscountModal: handleClose,
    handleSuccessDiscountModal: handleSuccess,
    completeDiscountModalFlow: completeFlow,
    hasCompletedDiscountModalFlow: hasCompleted,
  };
}
