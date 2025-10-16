import { useStoreContext } from "@/contexts/StoreContext";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { getProductName } from "@/lib/productUtils";
import { ProductSku } from "@athena/webapp";
import { useCheckout, type Discount } from "./CheckoutProvider";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import placeholder from "@/assets/placeholder.png";
import { motion } from "framer-motion";
import { Tag } from "lucide-react";
import InputWithEndButton from "../ui/input-with-end-button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { redeemPromoCode } from "@/api/promoCodes";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { getDiscountValue } from "./utils";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { isFeeWaived } from "@/lib/feeUtils";
import { Badge } from "../ui/badge";
import { useDiscountCodeAlert } from "@/hooks/useDiscountCodeAlert";

function SummaryItem({
  item,
  formatter,
  discount,
  totalItemsInBag,
}: {
  item: any;
  formatter: Intl.NumberFormat;
  discount?: Discount | null;
  totalItemsInBag: number;
}) {
  // Determine if this item is eligible for the discount
  const isEligible =
    discount &&
    (discount.span === "entire-order" ||
      (discount.span === "selected-products" &&
        discount.productSkus?.includes(item.productSkuId)));

  // Calculate the discounted price per unit
  const discountedPrice = isEligible
    ? discount.type === "percentage"
      ? item.price * (1 - discount.value / 100)
      : Math.max(0, item.price - discount.value)
    : item.price;

  const isFree = isEligible && discountedPrice === 0;

  // For entire-order discounts, only show strikethrough if there's 1 item in bag
  // For selected-products discounts, always show strikethrough for eligible items
  const shouldShowDiscount =
    isEligible &&
    discountedPrice < item.price &&
    (discount.span === "selected-products" || totalItemsInBag === 1);

  const hasDiscount = shouldShowDiscount;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="h-12 w-12 rounded-lg overflow-hidden">
          <img
            src={item.productImage || placeholder}
            alt={item.productName || "product image"}
            className="aspect-square object-cover rounded-lg"
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">{getProductName(item)}</p>
          {!isFree && !hasDiscount && (
            <p className="text-xs text-muted-foreground">
              {formatter.format(item.price * item.quantity)}
            </p>
          )}
          {hasDiscount && !isFree && (
            <div className="flex items-center gap-2 text-xs">
              <p className="text-muted-foreground line-through">
                {formatter.format(item.price * item.quantity)}
              </p>
              <p className="text-xs">
                {formatter.format(discountedPrice * item.quantity)}
              </p>
            </div>
          )}
          {isFree && (
            <div className="flex items-center gap-2 text-xs">
              <p className="text-muted-foreground line-through">
                {formatter.format(item.price * item.quantity)}
              </p>
              <p className="text-xs">Free</p>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{`x ${item.quantity}`}</p>
    </div>
  );
}

export function BagSummaryItems({
  items,
  discount,
}: {
  items: ProductSku[];
  discount?: Discount | null;
}) {
  const { formatter } = useStoreContext();

  if (!items) return null;

  const totalItemsInBag = items.length;

  return (
    <div className="space-y-12 w-full">
      {items?.map((item: ProductSku, index: number) => (
        <SummaryItem
          formatter={formatter}
          item={item}
          discount={discount}
          totalItemsInBag={totalItemsInBag}
          key={index}
        />
      ))}
    </div>
  );
}

function BagSummary() {
  const { formatter, store } = useStoreContext();
  const { bagSubtotal } = useShoppingBag();
  const { checkoutState, updateState, activeSession } = useCheckout();
  const { userId, guestId } = useAuth();
  const [code, setCode] = useState("");
  const [invalidMessage, setInvalidMessage] = useState("");
  const [isAutoApplyingPromoCode, setIsAutoApplyingPromoCode] = useState(false);
  const { waiveDeliveryFees } = store?.config || {};

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
        handleRedeemPromoCode(codeToApply.code);
      }
    }
  }, [promoCodes, checkoutState.discount, activeSession._id, redeemedOffers]);

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
            totalDiscount: data.promoCode.totalDiscount,
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
    onError: (error) => {
      setInvalidMessage(error.message);
    },
  });

  const handleRedeemPromoCode = (promoCode?: string) => {
    const storeFrontUserId = userId || guestId;
    let codeToUse = code;

    if (typeof promoCode === "string") {
      codeToUse = promoCode;
    }

    setInvalidMessage("");

    if (!storeFrontUserId || !store || !codeToUse || !activeSession._id) return;

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

  const isFeeWaivedForCurrentOption = isFeeWaived(
    waiveDeliveryFees,
    checkoutState.deliveryOption
  );

  return (
    <motion.div className="py-6 bg-background shadow-sm rounded-lg w-[80vw] lg:w-[30vw] space-y-12">
      <div className="flex items-center px-6 w-full">
        <p>Order summary</p>
        <div className="ml-auto">
          <Link to="/shop/bag">
            <Button variant={"clear"}>
              <p>Update bag</p>
            </Button>
          </Link>
        </div>
      </div>

      <div className="px-8">
        <BagSummaryItems
          items={checkoutState?.bag?.items}
          discount={checkoutState.discount}
        />
      </div>

      {/* Promo Code */}
      <div className="px-8 space-y-2">
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
              <p className="px-2 text-xs text-destructive">{invalidMessage}</p>
            )}
          </div>

          <div className="px-4 space-y-4">
            {checkoutState.discount && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, ease: "easeInOut" }}
                className="flex items-center gap-2"
              >
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
                    className="bg-accent5/60 text-accent2 border-none"
                  >
                    <Tag className="w-3 h-3 mr-2" />
                    <p className="text-xs font-medium">Free delivery applied</p>
                  </Badge>
                </motion.div>
              )}
          </div>
        </div>
      </div>

      <Separator className="bg-accent5" />

      {/* Summary */}
      <div className="px-8 space-y-8 pt-4 mt-4">
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
            <p className="text-sm">Discounts</p>
            <p className="text-sm">- {formatter.format(discountValue)}</p>
          </div>
        )}
        <div className="flex justify-between font-medium">
          <p className="text-lg">Total</p>
          <p className="text-lg">{formatter.format(total)}</p>
        </div>
      </div>
    </motion.div>
  );
}

export default BagSummary;
