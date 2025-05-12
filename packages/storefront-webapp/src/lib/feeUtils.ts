// We need to define the DeliveryOption type here since it's not exported from CheckoutProvider
type DeliveryOption = "within-accra" | "outside-accra" | "intl";

/**
 * Determines if a delivery fee should be waived based on the current delivery option
 *
 * @param waiveDeliveryFees - Boolean or object specifying which fees to waive
 * @param deliveryOption - The current delivery option selected by the user
 * @returns Boolean indicating if the fee should be waived
 */
export const isFeeWaived = (
  waiveDeliveryFees:
    | boolean
    | {
        withinAccra?: boolean;
        otherRegions?: boolean;
        international?: boolean;
        all?: boolean;
      }
    | undefined
    | null,
  deliveryOption: DeliveryOption | null
): boolean => {
  // Handle boolean waiveDeliveryFees (legacy format)
  if (typeof waiveDeliveryFees === "boolean") {
    return waiveDeliveryFees;
  }

  // Handle undefined/null waiveDeliveryFees
  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  // If "all" is true, all fees are waived
  if (waiveDeliveryFees.all) {
    return true;
  }

  // If no delivery option selected, no fee waiver (default state)
  if (!deliveryOption) {
    return false;
  }

  // Check for the specific delivery option
  if (deliveryOption === "within-accra") {
    return !!waiveDeliveryFees.withinAccra;
  } else if (deliveryOption === "outside-accra") {
    return !!waiveDeliveryFees.otherRegions;
  } else if (deliveryOption === "intl") {
    return !!waiveDeliveryFees.international;
  }

  // Default to false if option doesn't match
  return false;
};

/**
 * Determines if any fee type is waived
 * Used to display indicators that at least some fee types are being waived
 */
export const isAnyFeeWaived = (
  waiveDeliveryFees:
    | boolean
    | {
        withinAccra?: boolean;
        otherRegions?: boolean;
        international?: boolean;
        all?: boolean;
      }
    | undefined
    | null
): boolean => {
  // Handle boolean waiveDeliveryFees (legacy format)
  if (typeof waiveDeliveryFees === "boolean") {
    return waiveDeliveryFees;
  }

  // Handle undefined/null waiveDeliveryFees
  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  // Check if any of the fee types are waived
  return !!(
    waiveDeliveryFees.all ||
    waiveDeliveryFees.withinAccra ||
    waiveDeliveryFees.otherRegions ||
    waiveDeliveryFees.international
  );
};
