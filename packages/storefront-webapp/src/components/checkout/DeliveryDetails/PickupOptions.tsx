import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckout } from "../CheckoutProvider";
import { GhostButton } from "@/components/ui/ghost-button";
import { Store, Truck } from "lucide-react";

export const PickupOptions = () => {
  const { checkoutState, updateState } = useCheckout();

  const { formatter } = useStoreContext();

  const isDelivery = checkoutState.deliveryMethod === "delivery";
  const isPickup = checkoutState.deliveryMethod === "pickup";

  return (
    <div className="flex gap-4 w-full">
      <GhostButton
        type="button"
        onClick={() => {
          updateState({
            deliveryMethod: "delivery",
            deliveryFee: null,
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

          {Boolean(checkoutState.deliveryFee) && (
            <p className="text-xs text-[#EC4683] text-start w-full">
              {formatter.format(checkoutState.deliveryFee || 0)}
            </p>
          )}
        </div>
      </GhostButton>
      <GhostButton
        type="button"
        onClick={() => {
          updateState({
            deliveryMethod: "pickup",
            pickupLocation: "wigclub-hair-studio",
            billingDetails: null,
          });
        }}
        selected={isPickup}
        className="h-[64px] w-[50%] justify-start"
      >
        <div className="w-full space-y-2">
          <div className="flex items-center">
            <Store className="w-4 h-4 mr-2" />
            Store pickup
          </div>

          {Boolean(checkoutState.isPickupOrder) && (
            <p className="text-xs text-[#EC4683] text-start w-full">Free</p>
          )}
        </div>
      </GhostButton>
    </div>
  );
};
