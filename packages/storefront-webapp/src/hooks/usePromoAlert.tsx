import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useModalState } from "./useModalState";

const PROMO_ALERT_COOLDOWN_HOURS = 24;
const PROMO_ALERT_LOCALSTORAGE_KEY = "promo_alert_last_shown";
const PROMO_ALERT_COMPLETED_KEY = "promo_alert_completed";
const PROMO_ALERT_DISMISSED_KEY = "promo_alert_dismissed";
const THRESHOLD_PERCENTAGE = 50;

/**
 * Custom hook to handle promo alert logic
 * Uses useModalState for base functionality plus threshold checking
 */
export function usePromoAlert() {
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoItems } = useQuery(promoCodeQueries.getAllItems());
  const promoItem = promoItems?.[0];

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
    cooldownDays: PROMO_ALERT_COOLDOWN_HOURS / 24, // Convert hours to days
    lastShownKey: PROMO_ALERT_LOCALSTORAGE_KEY,
    completedKey: PROMO_ALERT_COMPLETED_KEY,
    dismissedKey: PROMO_ALERT_DISMISSED_KEY,
  });

  // Additional logic specific to promo alerts (threshold checking)
  useEffect(() => {
    // Check if there's a valid promo item that meets threshold criteria
    if (promoItems?.length) {
      const promoItem = promoItems[0];
      if (
        promoItem &&
        promoItem.productSku &&
        typeof promoItem.quantity === "number" &&
        typeof promoItem.quantityClaimed === "number" &&
        promoItem.quantity > 0
      ) {
        const percentClaimed =
          (promoItem.quantityClaimed / promoItem.quantity) * 100;
        if (percentClaimed >= THRESHOLD_PERCENTAGE && percentClaimed < 100) {
          setIsOpen(true);
          return;
        }
      }
    }

    setIsOpen(false);
  }, [promoItems, setIsOpen]);

  return {
    isPromoAlertOpen: isOpen,
    setIsPromoAlertOpen: setIsOpen,
    hasPromoAlertBeenShown: hasBeenShown,
    setHasPromoAlertBeenShown: setHasBeenShown,
    isPromoAlertDismissed: isDismissed,
    setIsPromoAlertDismissed: setIsDismissed,
    lastPromoAlertShownTime: lastShownTime,
    openPromoAlert: handleOpen,
    handleClosePromoAlert: handleClose,
    handleSuccessPromoAlert: handleSuccess,
    completePromoAlertFlow: completeFlow,
    hasCompletedPromoAlertFlow: hasCompleted,
    promoItem,
  };
}
