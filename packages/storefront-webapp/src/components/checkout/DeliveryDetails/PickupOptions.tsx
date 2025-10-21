import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckout } from "@/hooks/useCheckout";
import { GhostButton } from "@/components/ui/ghost-button";
import { Truck } from "lucide-react";
import { StoreIcon } from "lucide-react";
import { isFeeWaived } from "@/lib/feeUtils";

// Helper function to check if restriction is within time window
function isWithinRestrictionTime(restriction: any): boolean {
  if (!restriction?.isActive) return false;

  const now = Date.now();
  const { startTime, endTime } = restriction;

  // If no times set, restriction is always active
  if (!startTime && !endTime) return true;

  // Check if within time window
  if (startTime && now < startTime) return false;
  if (endTime && now > endTime) return false;

  return true;
}

export const PickupOptions = () => {
  const { checkoutState, updateState } = useCheckout();
  const { formatter, store } = useStoreContext();
  const { waiveDeliveryFees, fulfillment } = store?.config || {};

  const isPickup = checkoutState.deliveryMethod === "pickup";
  const isDelivery = checkoutState.deliveryMethod === "delivery";

  // Default to true if not set (for backward compatibility)
  const isPickupEnabled = fulfillment?.enableStorePickup ?? true;
  const isDeliveryEnabled = fulfillment?.enableDelivery ?? true;

  // Check for temporary restrictions
  const pickupRestriction = fulfillment?.pickupRestriction;
  const deliveryRestriction = fulfillment?.deliveryRestriction;

  const isPickupRestricted =
    pickupRestriction?.isActive && isWithinRestrictionTime(pickupRestriction);
  const isDeliveryRestricted =
    deliveryRestriction?.isActive &&
    isWithinRestrictionTime(deliveryRestriction);

  // Final availability
  const showPickup = isPickupEnabled;
  const pickupAvailable = isPickupEnabled && !isPickupRestricted;
  const showDelivery = isDeliveryEnabled;
  const deliveryAvailable = isDeliveryEnabled && !isDeliveryRestricted;

  // Use the shared utility function to determine if the fee should be waived
  const isFeeWaivedForCurrentOption = isFeeWaived(
    waiveDeliveryFees,
    checkoutState.deliveryOption
  );

  return (
    <div className="flex items-center gap-4">
      {showPickup && (
        <GhostButton
          type="button"
          onClick={() => {
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
          }}
          disabled={!pickupAvailable}
          selected={isPickup}
          className={`h-[64px] ${!showDelivery ? "w-full" : "w-[50%]"}`}
        >
          <div className="w-full space-y-2">
            <div className="flex items-center">
              <StoreIcon className="w-4 h-4 mr-2" /> Store pickup
            </div>

            <p className="text-xs text-start w-full">
              {pickupAvailable ? (
                "Free"
              ) : (
                <span>
                  {pickupRestriction?.message || "Temporarily unavailable"}
                </span>
              )}
            </p>
          </div>
        </GhostButton>
      )}

      {showDelivery && (
        <GhostButton
          type="button"
          onClick={() => {
            if (deliveryAvailable) {
              updateState({
                deliveryMethod: "delivery",
                deliveryFee: isFeeWaivedForCurrentOption ? 0 : null,
                pickupLocation: null,
              });
            }
          }}
          disabled={!deliveryAvailable}
          selected={isDelivery}
          className={`h-[64px] ${!showPickup ? "w-full" : "w-[50%]"}`}
        >
          <div className="w-full space-y-2">
            <div className="flex items-center">
              <Truck className="w-4 h-4 mr-2" />
              Delivery
            </div>

            {deliveryAvailable ? (
              <>
                {isFeeWaivedForCurrentOption && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-startl">Free</p>
                  </div>
                )}

                {Boolean(checkoutState.deliveryFee) &&
                  !isFeeWaivedForCurrentOption && (
                    <p className="text-xs text-[#EC4683] text-start w-full">
                      {formatter.format(checkoutState.deliveryFee || 0)}
                    </p>
                  )}
              </>
            ) : (
              <p className="text-xs text-start w-full">
                <span>
                  {deliveryRestriction?.message || "Temporarily unavailable"}
                </span>
              </p>
            )}
          </div>
        </GhostButton>
      )}
    </div>
  );
};
