import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckout } from "../CheckoutProvider";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { getDiscountValue } from "../utils";
import { BagSummaryItems } from "../BagSummary";
import { Tag } from "lucide-react";
import { isFeeWaived, isAnyFeeWaived } from "@/lib/feeUtils";
import { Badge } from "@/components/ui/badge";

export default function OrderSummary() {
  const { formatter, store } = useStoreContext();
  const { bagSubtotal } = useShoppingBag();
  const { checkoutState } = useCheckout();
  const { waiveDeliveryFees } = store?.config || {};

  // Use the shared utility functions for fee waiving logic
  const isFeeWaivedForCurrentOption = isFeeWaived(
    waiveDeliveryFees,
    checkoutState.deliveryOption
  );

  const discountValue = getDiscountValue(bagSubtotal, checkoutState.discount);

  const total = (checkoutState.deliveryFee ?? 0) + bagSubtotal - discountValue;

  const discountText =
    checkoutState.discount?.type === "percentage"
      ? `${checkoutState.discount.value}%`
      : `${formatter.format(discountValue)}`;

  return (
    <div className="space-y-12">
      <p>Order summary</p>

      <BagSummaryItems items={checkoutState?.bag?.items} />

      <div className="space-y-8 pt-4 mt-4">
        <div className="flex justify-between">
          <p className="text-sm">Subtotal</p>
          <p className="text-sm">{formatter.format(bagSubtotal)}</p>
        </div>
        {checkoutState.deliveryMethod === "delivery" &&
          checkoutState.deliveryFee !== null &&
          checkoutState.deliveryOption && (
            <div className="flex justify-between">
              <p className="text-sm">Delivery</p>
              <p className="text-sm">
                {isFeeWaivedForCurrentOption
                  ? "Free"
                  : formatter.format(checkoutState.deliveryFee || 0)}
              </p>
            </div>
          )}
        {Boolean(discountValue) && (
          <div className="flex justify-between">
            <p className="text-sm">Discount</p>
            <p className="text-sm">- {formatter.format(discountValue)}</p>
          </div>
        )}

        <div className="space-y-4">
          {checkoutState.discount && (
            <div className="flex items-center gap-2">
              <Badge
                variant={"outline"}
                className="bg-accent5/60 text-accent2 border-none"
              >
                <Tag className="w-3.5 h-3.5 mr-2" />
                <p className="text-sm font-medium">
                  {checkoutState.discount?.code}
                </p>
              </Badge>

              <p className="text-sm">
                <strong>- {discountText} off entire order</strong>
              </p>
            </div>
          )}
          {isFeeWaivedForCurrentOption &&
            checkoutState.deliveryMethod === "delivery" && (
              <div className="flex items-center">
                <Badge
                  variant={"outline"}
                  className="bg-accent5/60 text-accent2 border-none"
                >
                  <Tag className="w-3.5 h-3.5 mr-2" />
                  <p className="text-sm font-medium">Free delivery applied</p>
                </Badge>
              </div>
            )}
        </div>
        <div className="flex justify-between font-medium">
          <p className="text-lg">Total</p>
          <p className="text-lg">{formatter.format(total)}</p>
        </div>
      </div>
    </div>
  );
}
