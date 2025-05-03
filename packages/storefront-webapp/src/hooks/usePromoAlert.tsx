import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";

const PROMO_ALERT_COOLDOWN_HOURS = 24;
const PROMO_ALERT_LOCALSTORAGE_KEY = "promo_alert_last_shown";
const THRESHOLD_PERCENTAGE = 50;

/**
 * Custom hook to handle promo alert logic
 * Handles threshold checking, cooldown, and state management
 */
export function usePromoAlert() {
  const [isOpen, setIsOpen] = useState(false);
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoItems } = useQuery(promoCodeQueries.getAllItems());
  const promoItem = promoItems?.[0];

  useEffect(() => {
    const lastShown = localStorage.getItem(PROMO_ALERT_LOCALSTORAGE_KEY);
    const now = Date.now();

    // Check if still in cooldown period
    if (
      lastShown &&
      now - parseInt(lastShown) < PROMO_ALERT_COOLDOWN_HOURS * 60 * 60 * 1000
    ) {
      setIsOpen(false);
      return;
    }

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
  }, [promoItems]);

  return {
    isPromoAlertOpen: isOpen,
    setIsPromoAlertOpen: setIsOpen,
    promoItem,
  };
}
