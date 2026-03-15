import { useEffect } from "react";
import { Store } from "@athena/webapp";
import { CheckoutState } from "../types";

type Restriction = {
  isActive?: boolean;
  startTime?: number;
  endTime?: number;
};

function isWithinRestrictionTime(restriction: Restriction): boolean {
  if (!restriction?.isActive) return false;

  const now = Date.now();
  const { startTime, endTime } = restriction;

  if (!startTime && !endTime) return true;
  if (startTime && now < startTime) return false;
  if (endTime && now > endTime) return false;

  return true;
}

export function computeFulfillmentAvailability(store: Store | undefined): {
  pickupAvailable: boolean;
  deliveryAvailable: boolean;
} {
  const fulfillment = store?.config?.fulfillment as
    | {
        enableStorePickup?: boolean;
        enableDelivery?: boolean;
        pickupRestriction?: Restriction;
        deliveryRestriction?: Restriction;
      }
    | undefined;

  const isPickupEnabled = fulfillment?.enableStorePickup ?? true;
  const isDeliveryEnabled = fulfillment?.enableDelivery ?? true;

  const pickupRestriction = fulfillment?.pickupRestriction;
  const deliveryRestriction = fulfillment?.deliveryRestriction;

  const isPickupRestricted =
    pickupRestriction?.isActive &&
    isWithinRestrictionTime(pickupRestriction);
  const isDeliveryRestricted =
    deliveryRestriction?.isActive &&
    isWithinRestrictionTime(deliveryRestriction);

  return {
    pickupAvailable: isPickupEnabled && !isPickupRestricted,
    deliveryAvailable: isDeliveryEnabled && !isDeliveryRestricted,
  };
}

export function useFulfillmentAvailability(
  pickupAvailable: boolean,
  deliveryAvailable: boolean,
  checkoutState: CheckoutState,
  updateState: (updates: Partial<CheckoutState>) => void
): void {
  // Auto-switch to delivery if pickup is disabled/restricted and currently selected
  useEffect(() => {
    if (!pickupAvailable && checkoutState.deliveryMethod === "pickup") {
      if (deliveryAvailable) {
        updateState({
          deliveryMethod: "delivery",
          deliveryOption: null,
          deliveryFee: null,
          pickupLocation: null,
        });
      }
    }
  }, [pickupAvailable, deliveryAvailable]);

  // Auto-switch to pickup if delivery is disabled/restricted and currently selected
  useEffect(() => {
    if (!deliveryAvailable && checkoutState.deliveryMethod === "delivery") {
      if (pickupAvailable) {
        updateState({
          deliveryMethod: "pickup",
          deliveryOption: null,
          deliveryFee: 0,
          paymentMethod: "online_payment",
          pickupLocation: "wigclub-hair-studio",
          podPaymentMethod: null,
        });
      }
    }
  }, [pickupAvailable, deliveryAvailable]);
}
