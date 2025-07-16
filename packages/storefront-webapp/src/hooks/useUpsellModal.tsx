import { useUserOffersQueries } from "@/lib/queries/userOffers";
import { useModalState } from "./useModalState";
import { useQuery } from "@tanstack/react-query";

const UPSELL_MODAL_COOLDOWN_DAYS = 30;
const UPSELL_MODAL_LAST_SHOWN_KEY = "upsell_modal_last_shown";
const UPSELL_MODAL_COMPLETED_KEY = "upsell_modal_completed";
const UPSELL_MODAL_DISMISSED_KEY = "upsell_modal_dismissed";

/**
 * Custom hook to handle discount code alert logic for the welcome back modal
 * Uses the generic useModalState hook for state management and checks eligibility
 */
export function useUpsellModal() {
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
    cooldownDays: UPSELL_MODAL_COOLDOWN_DAYS,
    lastShownKey: UPSELL_MODAL_LAST_SHOWN_KEY,
    completedKey: UPSELL_MODAL_COMPLETED_KEY,
    dismissedKey: UPSELL_MODAL_DISMISSED_KEY,
  });

  const offersQueries = useUserOffersQueries();

  const { data: redeemedOffers } = useQuery(offersQueries.redeemed());

  return {
    isUpsellModalOpen: isOpen,
    setIsUpsellModalOpen: setIsOpen,
    hasUpsellModalBeenShown: hasBeenShown || (redeemedOffers?.length ?? 0) > 0,
    setHasUpsellModalBeenShown: setHasBeenShown,
    isUpsellModalDismissed: isDismissed,
    setIsUpsellModalDismissed: setIsDismissed,
    lastUpsellModalShownTime: lastShownTime,
    isUpsellModalStateLoaded: isLoaded,
    openUpsellModal: handleOpen,
    handleCloseUpsellModal: handleClose,
    handleSuccessUpsellModal: handleSuccess,
    completeUpsellModalFlow: completeFlow,
    hasCompletedUpsellModalFlow: hasCompleted,
    redeemedOffers,
  };
}
