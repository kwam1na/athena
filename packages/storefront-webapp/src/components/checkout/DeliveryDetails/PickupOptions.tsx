import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckout } from "../CheckoutProvider";
import { GhostButton } from "@/components/ui/ghost-button";
import { Truck } from "lucide-react";
import { StoreIcon } from "lucide-react";
import { isFeeWaived } from "@/lib/feeUtils";

export const PickupOptions = () => {
  const { checkoutState, updateState } = useCheckout();
  const { formatter, store } = useStoreContext();
  const { waiveDeliveryFees } = store?.config || {};

  const isPickup = checkoutState.deliveryMethod === "pickup";
  const isDelivery = checkoutState.deliveryMethod === "delivery";

  // Use the shared utility function to determine if the fee should be waived
  const isFeeWaivedForCurrentOption = isFeeWaived(
    waiveDeliveryFees,
    checkoutState.deliveryOption
  );

  return (
    <div className="flex items-center gap-4">
      <GhostButton
        type="button"
        onClick={() => {
          updateState({
            deliveryMethod: "pickup",
            deliveryOption: null,
            deliveryFee: 0,
            paymentMethod: "online_payment",
            podPaymentMethod: null,
          });
        }}
        selected={isPickup}
        className="h-[64px] w-[50%]"
      >
        <div className="w-full space-y-2">
          <div className="flex items-center">
            <StoreIcon className="w-4 h-4 mr-2" /> Store pickup
          </div>

          <p className="text-xs text-start w-full">Free</p>
        </div>
      </GhostButton>

      <GhostButton
        type="button"
        onClick={() => {
          updateState({
            deliveryMethod: "delivery",
            deliveryFee: isFeeWaivedForCurrentOption ? 0 : null,
            pickupLocation: null,
          });
        }}
        selected={isDelivery}
        className="h-[64px] w-[50%]"
      >
        <div className="w-full space-y-2">
          <div className="flex items-center">
            <Truck className="w-4 h-4 mr-2" />
            Delivery
          </div>

          {isFeeWaivedForCurrentOption ? (
            <p className="text-xs text-start w-full">Free</p>
          ) : (
            Boolean(checkoutState.deliveryFee) && (
              <p className="text-xs text-[#EC4683] text-start w-full">
                {formatter.format(checkoutState.deliveryFee || 0)}
              </p>
            )
          )}
        </div>
      </GhostButton>
    </div>
  );
};
