import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Link } from "@tanstack/react-router";
import { useStoreContext } from "@/contexts/StoreContext";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useCheckout } from "./CheckoutProvider";
import { BagSummaryItems } from "./BagSummary";
import { Button } from "../ui/button";
import { Tag } from "lucide-react";
import InputWithEndButton from "../ui/input-with-end-button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getDiscountValue } from "./utils";
import { redeemPromoCode } from "@/api/promoCodes";
import { useAuth } from "@/hooks/useAuth";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";

export default function MobileBagSummary() {
  const { formatter, store } = useStoreContext();
  const { bagSubtotal } = useShoppingBag();
  const { checkoutState, updateState, activeSession } = useCheckout();
  const [invalidMessage, setInvalidMessage] = useState("");
  const [code, setCode] = useState("");
  const { userId, guestId } = useAuth();
  const { waiveDeliveryFees } = store?.config || {};
  const [isAutoApplyingPromoCode, setIsAutoApplyingPromoCode] = useState(false);

  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoCodes } = useQuery(promoCodeQueries.getAll());

  useEffect(() => {
    if (promoCodes?.length && !checkoutState.discount && activeSession._id) {
      const autoApplyPromoCode = promoCodes.find(
        (code) => code.autoApply && code.active
      );
      if (autoApplyPromoCode) {
        setIsAutoApplyingPromoCode(true);
        handleRedeemPromoCode(autoApplyPromoCode.code);
      }
    }
  }, [promoCodes, checkoutState.discount, activeSession._id]);

  const discountValue = getDiscountValue(bagSubtotal, checkoutState.discount);

  const total = (checkoutState.deliveryFee ?? 0) + bagSubtotal - discountValue;

  const discountText =
    checkoutState.discount?.type === "percentage"
      ? `${checkoutState.discount.value}%`
      : `${formatter.format(discountValue)}`;

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

  return (
    <div>
      <Accordion type="single" collapsible className="w-full space-y-4">
        <AccordionItem value="orderSummary" className="border-none">
          <AccordionTrigger className="flex w-full">
            <div className="flex items-center justify-between w-full pr-4">
              <p className="text-sm">Order summary</p>
              <p className="text-sm font-medium">{formatter.format(total)}</p>
            </div>
          </AccordionTrigger>

          <AccordionContent className="flex flex-col gap-4 py-4 pr-4 ">
            <div className="ml-auto">
              <Link to="/shop/bag">
                <Button className="p-0" variant={"clear"}>
                  <p>Update bag</p>
                </Button>
              </Link>
            </div>

            <BagSummaryItems items={checkoutState?.bag?.items} />

            {/* Promo Code */}
            <div className="pt-8">
              <div className="space-y-6">
                <div className="space-y-4">
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
                    <p className="px-2 text-xs text-destructive">
                      {invalidMessage}
                    </p>
                  )}
                </div>
                {checkoutState.discount && (
                  <div className="flex items-center">
                    <Tag className="w-3.5 h-3.5 mr-2" />
                    <p className="text-sm font-medium">
                      {checkoutState.discount?.code} -{" "}
                      <strong>{discountText} off entire order</strong>
                    </p>
                  </div>
                )}
              </div>
            </div>

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
              <div className="flex justify-between font-medium">
                <p className="text-lg">Total</p>
                <p className="text-lg">{formatter.format(total)}</p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
