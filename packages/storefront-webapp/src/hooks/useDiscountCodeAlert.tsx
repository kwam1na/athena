import { useModalState } from "./useModalState";
import { useEffect } from "react";

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

  useEffect(() => {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("welcome_")) {
        localStorage.removeItem(key);
      }
    });
  }, []);

  return {
    isDiscountModalOpen: isOpen,
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
