// We need to define the DeliveryOption type here since it's not exported from CheckoutProvider
type DeliveryOption = "within-accra" | "outside-accra" | "intl";

type WaiveDeliveryFeesConfig =
  | {
      withinAccra?: boolean;
      otherRegions?: boolean;
      international?: boolean;
      all?: boolean;
      minimumOrderAmount?: number; // in pesewas
    }
  | undefined
  | null;

// Helper: check threshold. Returns true if waiver should proceed.
// Both minimumOrderAmount and subtotal are in pesewas.
const meetsThreshold = (
  minimumOrderAmount: number | undefined,
  subtotal: number | undefined,
): boolean => {
  if (!minimumOrderAmount || minimumOrderAmount <= 0) return true;
  if (subtotal === undefined) return true;
  return subtotal >= minimumOrderAmount;
};

/**
 * Determines if a delivery fee should be waived based on the current delivery option
 *
 * @param waiveDeliveryFees - Boolean or object specifying which fees to waive
 * @param deliveryOption - The current delivery option selected by the user
 * @param subtotal - The cart subtotal in pesewas (optional, for threshold checks)
 * @returns Boolean indicating if the fee should be waived
 */
export const isFeeWaived = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  deliveryOption: DeliveryOption | null,
  subtotal?: number,
): boolean => {
  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  const { minimumOrderAmount } = waiveDeliveryFees;

  // If "all" is true, check threshold before returning
  if (waiveDeliveryFees.all) {
    return meetsThreshold(minimumOrderAmount, subtotal);
  }

  // If no delivery option selected, no fee waiver (default state)
  if (!deliveryOption) {
    return false;
  }

  // Check for the specific delivery option
  let regionFlag = false;
  if (deliveryOption === "within-accra") {
    regionFlag = !!waiveDeliveryFees.withinAccra;
  } else if (deliveryOption === "outside-accra") {
    regionFlag = !!waiveDeliveryFees.otherRegions;
  } else if (deliveryOption === "intl") {
    regionFlag = !!waiveDeliveryFees.international;
  }

  if (!regionFlag) return false;

  return meetsThreshold(minimumOrderAmount, subtotal);
};

/**
 * Determines if any fee type is waived
 * Used to display indicators that at least some fee types are being waived
 */
export const isAnyFeeWaived = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  subtotal?: number,
): boolean => {
  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  // Check if any of the fee types are waived
  const anyWaived = !!(
    waiveDeliveryFees.all ||
    waiveDeliveryFees.withinAccra ||
    waiveDeliveryFees.otherRegions ||
    waiveDeliveryFees.international
  );

  if (!anyWaived) return false;

  return meetsThreshold(waiveDeliveryFees.minimumOrderAmount, subtotal);
};

/**
 * Checks if a waiver is configured for a region, ignoring threshold entirely.
 * Needed by the nudge feature to determine if a waiver exists before checking
 * if the subtotal meets the threshold.
 */
export const hasWaiverConfigured = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  deliveryOption: DeliveryOption | null,
): boolean => {
  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  // If "all" is true, a waiver is configured
  if (waiveDeliveryFees.all) {
    return true;
  }

  // If no delivery option selected, no waiver configured
  if (!deliveryOption) {
    return false;
  }

  // Check for the specific delivery option flag (ignoring threshold)
  if (deliveryOption === "within-accra") {
    return !!waiveDeliveryFees.withinAccra;
  } else if (deliveryOption === "outside-accra") {
    return !!waiveDeliveryFees.otherRegions;
  } else if (deliveryOption === "intl") {
    return !!waiveDeliveryFees.international;
  }

  return false;
};

/**
 * Returns the remaining pesewas needed to reach the free delivery threshold,
 * or null if not applicable (no waiver configured, no threshold, or already met).
 *
 * @param waiveDeliveryFees - Boolean or object specifying which fees to waive
 * @param deliveryOption - The current delivery option selected by the user
 * @param subtotal - The cart subtotal in pesewas
 */
export const getRemainingForFreeDelivery = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  deliveryOption: DeliveryOption | null,
  subtotal: number,
): number | null => {
  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return null;
  }

  // Must have a waiver configured for the region
  if (!hasWaiverConfigured(waiveDeliveryFees, deliveryOption)) {
    return null;
  }

  const { minimumOrderAmount } = waiveDeliveryFees;

  // No threshold set — already free unconditionally
  if (!minimumOrderAmount || minimumOrderAmount <= 0) {
    return null;
  }

  // Already meets threshold
  if (subtotal >= minimumOrderAmount) {
    return null;
  }

  return minimumOrderAmount - subtotal;
};
