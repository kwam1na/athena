import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckout } from "../CheckoutProvider";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { getDiscountValue } from "../utils";
import { BagSummaryItems } from "../BagSummary";
import { Tag } from "lucide-react";
import { isFeeWaived, isAnyFeeWaived } from "@/lib/feeUtils";
import { Badge } from "@/components/ui/badge";
import InputWithEndButton from "@/components/ui/input-with-end-button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation } from "@tanstack/react-query";
import { redeemPromoCode } from "@/api/promoCodes";

export default function OrderSummary() {
  const { formatter, store } = useStoreContext();
  const { bagSubtotal } = useShoppingBag();
  const { checkoutState, activeSession, updateState } = useCheckout();
  const { waiveDeliveryFees } = store?.config || {};

  const [invalidMessage, setInvalidMessage] = useState("");
  const [code, setCode] = useState("");
  const { userId, guestId } = useAuth();
  const [isAutoApplyingPromoCode, setIsAutoApplyingPromoCode] = useState(false);

  const redeemPromoCodeMutation = useMutation({
    mutationFn: redeemPromoCode,
    onSuccess: (data: any) => {
      if (data.promoCode) {
        updateState({
          discount: {
            id: data.promoCode._id,
            code: data.promoCode.code,
            value: data.promoCode.discountValue,
            type: data.promoCode.discountType,
            span: data.promoCode.span,
            productSkus: data.promoCode.productSkus,
          },
        });
      } else {
        if (isAutoApplyingPromoCode) {
          setIsAutoApplyingPromoCode(false);
          return;
        }
        setInvalidMessage(data.message);
      }

      if (isAutoApplyingPromoCode) {
        setIsAutoApplyingPromoCode(false);
      }
    },
  });

  // Use the shared utility functions for fee waiving logic
  const isFeeWaivedForCurrentOption = isFeeWaived(
    waiveDeliveryFees,
    checkoutState.deliveryOption
  );

  const bagItems =
    checkoutState.bag?.items?.map((item: any) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      price: item.price,
    })) || [];

  const discountValue = getDiscountValue(bagItems, checkoutState.discount);

  const total = (checkoutState.deliveryFee ?? 0) + bagSubtotal - discountValue;

  const discountText =
    checkoutState.discount?.type === "percentage"
      ? `${checkoutState.discount.value}%`
      : `${formatter.format(discountValue)}`;

  const handleRedeemPromoCode = (promoCode?: string) => {
    const storeFrontUserId = userId || guestId;

    let codeToUse = code;

    if (typeof promoCode === "string") {
      codeToUse = promoCode;
    }

    setInvalidMessage("");

    if (!storeFrontUserId || !store || !codeToUse || !activeSession._id) {
      return;
    }

    redeemPromoCodeMutation.mutate({
      code: codeToUse,
      checkoutSessionId: activeSession._id,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && code.trim()) {
      handleRedeemPromoCode();
    }
  };

  const discountSpan =
    checkoutState.discount?.span == "entire-order"
      ? "entire order"
      : "select items";

  return (
    <div className="space-y-12">
      <p>Order summary</p>

      <BagSummaryItems
        items={checkoutState?.bag?.items}
        discount={checkoutState.discount}
      />

      <div className="space-y-8 pt-4 mt-4">
        <div className="space-y-4 pb-8">
          <InputWithEndButton
            isLoading={redeemPromoCodeMutation.isPending}
            value={code}
            onInputChange={(value) => setCode(value.toUpperCase())}
            placeholder="Enter promo code"
            buttonText="Apply"
            onButtonClick={handleRedeemPromoCode}
            onKeyDown={handleKeyDown}
          />
          {invalidMessage && (
            <p className="px-2 text-xs text-destructive">{invalidMessage}</p>
          )}
        </div>

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
                <Tag className="w-3 h-3 mr-2" />
                <p className="text-xs font-medium">
                  {checkoutState.discount?.code}
                </p>
              </Badge>

              <p className="text-xs">
                <strong>
                  - {discountText} off {discountSpan}
                </strong>
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
                  <Tag className="w-3 h-3 mr-2" />
                  <p className="text-xs font-medium">Free delivery applied</p>
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
