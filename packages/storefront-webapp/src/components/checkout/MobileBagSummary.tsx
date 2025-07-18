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
import { useMedia } from "react-use";
import { getDiscountValue } from "./utils";
import { redeemPromoCode } from "@/api/promoCodes";
import { useAuth } from "@/hooks/useAuth";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { isFeeWaived } from "@/lib/feeUtils";
import { Badge } from "../ui/badge";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useDiscountCodeAlert } from "@/hooks/useDiscountCodeAlert";

export default function MobileBagSummary() {
  const { formatter, store } = useStoreContext();
  const { bagSubtotal } = useShoppingBag();
  const { checkoutState, updateState, activeSession } = useCheckout();
  const [invalidMessage, setInvalidMessage] = useState("");
  const [code, setCode] = useState("");
  const { userId, guestId } = useAuth();
  const { waiveDeliveryFees } = store?.config || {};
  const [isAutoApplyingPromoCode, setIsAutoApplyingPromoCode] = useState(false);
  const isMobile = useMedia("(max-width: 768px)");

  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoCodes } = useQuery(promoCodeQueries.getAll());
  const { redeemedOffers } = useDiscountCodeAlert();

  useEffect(() => {
    if (promoCodes?.length && !checkoutState.discount && activeSession._id) {
      const autoApplyPromoCode = promoCodes.find(
        (code) => code.autoApply && code.active && !code.isExclusive
      );

      const exclusivePromoCodes = promoCodes.filter(
        (code) => code.isExclusive && code.active && code.autoApply
      );

      const exclusivePromoCode = exclusivePromoCodes.find((code) =>
        redeemedOffers?.some(
          (offer: any) => offer.promoCodeId === code._id && !offer.isRedeemed
        )
      );

      const codeToApply = autoApplyPromoCode || exclusivePromoCode;

      if (codeToApply) {
        setIsAutoApplyingPromoCode(true);
        if (isMobile) {
          toast.success("Auto-applying available promo codes..", {
            position: "top-center",
            duration: 950,
            style: {
              background: "#FFF5F9",
            },
          });
        }
        handleRedeemPromoCode(codeToApply.code);
      }
    }
  }, [promoCodes, checkoutState.discount, activeSession._id, redeemedOffers]);

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
        setTimeout(() => {
          setIsAutoApplyingPromoCode(false);
        }, 1000);
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

  // Use the shared utility function to determine if fee should be waived
  const isFeeWaivedForCurrentOption = isFeeWaived(
    waiveDeliveryFees,
    checkoutState.deliveryOption
  );

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

                <div className="space-y-4">
                  {checkoutState.discount && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.4, ease: "easeInOut" }}
                      className="flex items-center gap-2"
                    >
                      <Badge
                        variant={"outline"}
                        className="bg-accent2/10 text-accent2 border-none"
                      >
                        <Tag className="w-3 h-3 mr-2" />
                        <p className="text-xs font-medium">
                          {checkoutState.discount?.code}
                        </p>
                      </Badge>

                      <p className="text-xs">
                        <strong>- {discountText} off entire order</strong>
                      </p>
                    </motion.div>
                  )}

                  {isFeeWaivedForCurrentOption &&
                    checkoutState.deliveryMethod === "delivery" && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex items-center"
                      >
                        <Badge
                          variant={"outline"}
                          className="bg-accent2/10 text-accent2 border-none"
                        >
                          <Tag className="w-3 h-3 mr-2" />
                          <p className="text-xs font-medium">
                            Free delivery applied
                          </p>
                        </Badge>
                      </motion.div>
                    )}
                </div>
              </div>
            </div>

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
