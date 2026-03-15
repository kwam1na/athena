import { isFeeWaived } from "@/lib/feeUtils";
import { CheckoutState } from "./types";

type WaiveDeliveryFees =
  | boolean
  | {
      withinAccra?: boolean;
      otherRegions?: boolean;
      international?: boolean;
      all?: boolean;
    }
  | undefined
  | null;

export interface DeriveCheckoutConfig {
  waiveDeliveryFees: WaiveDeliveryFees;
  deliveryFees?: { international?: number } | undefined;
}

export function deriveCheckoutState(
  prev: CheckoutState,
  updates: Partial<CheckoutState>,
  config: DeriveCheckoutConfig
): CheckoutState {
  const { waiveDeliveryFees, deliveryFees } = config;
  const newUpdates = { ...prev, ...updates };

  const isDeliveryOrder = newUpdates.deliveryMethod == "delivery";
  const isPickupOrder = newUpdates.deliveryMethod == "pickup";

  const isGhanaOrder =
    isPickupOrder ||
    (isDeliveryOrder && newUpdates.deliveryDetails?.country == "GH");

  // Always set international delivery for non-Ghana countries
  if (
    isDeliveryOrder &&
    newUpdates.deliveryDetails?.country &&
    newUpdates.deliveryDetails.country !== "GH" &&
    newUpdates.deliveryOption !== "intl"
  ) {
    const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl");

    newUpdates.deliveryOption = "intl";
    newUpdates.deliveryFee = shouldWaiveIntlFee
      ? 0
      : deliveryFees?.international || 800;
  }

  const isUSOrder =
    isDeliveryOrder && newUpdates.deliveryDetails?.country == "US";

  const isROWOrder = isDeliveryOrder && !isUSOrder && !isGhanaOrder;

  const didSelectPickupLocation = Boolean(
    isPickupOrder && newUpdates.pickupLocation
  );

  const didProvideAllUSAddressFields = Boolean(
    newUpdates.deliveryDetails?.address &&
      newUpdates.deliveryDetails?.city &&
      newUpdates.deliveryDetails?.state &&
      newUpdates.deliveryDetails?.zip
  );

  const didProvideAllRestOfWorldFields = Boolean(
    newUpdates.deliveryDetails?.address && newUpdates.deliveryDetails?.city
  );

  const didProvideAllGhanaAddressFields = Boolean(
    newUpdates.deliveryDetails?.street && newUpdates.deliveryDetails?.region
  );

  const didEnterDeliveryDetails =
    (isUSOrder
      ? didProvideAllUSAddressFields
      : isGhanaOrder && isDeliveryOrder
        ? didProvideAllGhanaAddressFields
        : didProvideAllRestOfWorldFields) &&
    Boolean(newUpdates.deliveryOption);

  const didProvideAllUSBillingAddressFields = Boolean(
    newUpdates.billingDetails?.address &&
      newUpdates.billingDetails?.city &&
      newUpdates.billingDetails?.state &&
      newUpdates.billingDetails?.zip
  );

  const didProvideAllRestOfWorldBillingFields = Boolean(
    newUpdates.billingDetails?.address && newUpdates.billingDetails?.city
  );

  const didProvideAllGhanaBillingAddressFields = Boolean(
    newUpdates.billingDetails?.address && newUpdates.billingDetails?.city
  );

  const isGhanaBillingAddrss = newUpdates.billingDetails?.country == "GH";
  const isUSBillingAddrss = newUpdates.billingDetails?.country == "US";

  const didEnterBillingDetails = isGhanaBillingAddrss
    ? didProvideAllGhanaBillingAddressFields
    : isUSBillingAddrss
      ? didProvideAllUSBillingAddressFields
      : didProvideAllRestOfWorldBillingFields;

  return {
    ...newUpdates,
    didEnterDeliveryDetails,
    didEnterBillingDetails,
    didSelectPickupLocation,
    isGhanaOrder,
    isUSOrder,
    isROWOrder,
    isPickupOrder,
    isDeliveryOrder,
  };
}
