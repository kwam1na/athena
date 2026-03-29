import { CheckoutState } from "./types";

export function deriveCheckoutState(state: CheckoutState): CheckoutState {
  const isDeliveryOrder = state.deliveryMethod === "delivery";
  const isPickupOrder = state.deliveryMethod === "pickup";

  const isGhanaOrder =
    isPickupOrder ||
    (isDeliveryOrder && state.deliveryDetails?.country === "GH");

  const isUSOrder = isDeliveryOrder && state.deliveryDetails?.country === "US";

  const isROWOrder = isDeliveryOrder && !isUSOrder && !isGhanaOrder;

  const didSelectPickupLocation = Boolean(
    isPickupOrder && state.pickupLocation
  );

  const didProvideAllUSAddressFields = Boolean(
    state.deliveryDetails?.address &&
      state.deliveryDetails?.city &&
      state.deliveryDetails?.state &&
      state.deliveryDetails?.zip
  );

  const didProvideAllRestOfWorldFields = Boolean(
    state.deliveryDetails?.address && state.deliveryDetails?.city
  );

  const didProvideAllGhanaAddressFields = Boolean(
    state.deliveryDetails?.street && state.deliveryDetails?.region
  );

  const didEnterDeliveryDetails =
    (isUSOrder
      ? didProvideAllUSAddressFields
      : isGhanaOrder && isDeliveryOrder
        ? didProvideAllGhanaAddressFields
        : didProvideAllRestOfWorldFields) &&
    Boolean(state.deliveryOption);

  const didProvideAllUSBillingAddressFields = Boolean(
    state.billingDetails?.address &&
      state.billingDetails?.city &&
      state.billingDetails?.state &&
      state.billingDetails?.zip
  );

  const didProvideAllRestOfWorldBillingFields = Boolean(
    state.billingDetails?.address && state.billingDetails?.city
  );

  const didProvideAllGhanaBillingAddressFields = Boolean(
    state.billingDetails?.address && state.billingDetails?.city
  );

  const isGhanaBillingAddress = state.billingDetails?.country === "GH";
  const isUSBillingAddress = state.billingDetails?.country === "US";

  const didEnterBillingDetails = isGhanaBillingAddress
    ? didProvideAllGhanaBillingAddressFields
    : isUSBillingAddress
      ? didProvideAllUSBillingAddressFields
      : didProvideAllRestOfWorldBillingFields;

  return {
    ...state,
    isPickupOrder,
    isDeliveryOrder,
    isGhanaOrder,
    isUSOrder,
    isROWOrder,
    didSelectPickupLocation,
    didEnterDeliveryDetails,
    didEnterBillingDetails,
  };
}
