import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckout } from "../CheckoutProvider";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { getDiscountValue } from "../utils";
import { BagSummaryItems } from "../BagSummary";
import { Tag } from "lucide-react";

export default function OrderSummary() {
  const { formatter, store } = useStoreContext();
  const { bagSubtotal } = useShoppingBag();
  const { checkoutState } = useCheckout();
  const { waiveDeliveryFees } = store?.config || {};

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
        {checkoutState.deliveryMethod === "delivery" && (
          <div className="flex justify-between">
            <p className="text-sm">Shipping</p>
            <p className="text-sm">
              {waiveDeliveryFees
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

        {checkoutState.discount && (
          <div className="flex items-center">
            <Tag className="w-3.5 h-3.5 mr-2" />
            <p className="text-sm font-medium">
              {checkoutState.discount?.code} -{" "}
              <strong>{discountText} off entire order</strong>
            </p>
          </div>
        )}
        {waiveDeliveryFees && checkoutState.deliveryMethod === "delivery" && (
          <div className="flex items-center">
            <Tag className="w-3.5 h-3.5 mr-2" />
            <p className="text-sm font-medium">
              <strong>Free shipping applied</strong>
            </p>
          </div>
        )}
        <div className="flex justify-between font-medium">
          <p className="text-lg">Total</p>
          <p className="text-lg">{formatter.format(total)}</p>
        </div>
      </div>
    </div>
  );
}
