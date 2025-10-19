import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useStoreContext } from "@/contexts/StoreContext";
import {
  getActiveCheckoutSession,
  updateCheckoutSession,
} from "@/api/checkoutSession";
import { postAnalytics } from "@/api/analytics";
import { capitalizeFirstLetter } from "@/lib/utils";
import { FadeIn } from "@/components/common/FadeIn";
import { BagSummaryItems } from "@/components/checkout/BagSummary";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { GuestRewardsPrompt } from "@/components/rewards/GuestRewardsPrompt";
import {
  CheckoutProvider,
  Discount,
  useCheckout,
  webOrderSchema,
} from "@/components/checkout/CheckoutProvider";
import { DeliveryDetails } from "@/components/checkout/DeliveryDetails/DeliverySection";
import { useBagQueries } from "@/lib/queries/bag";
import { useEffect } from "react";
import { getDiscountValue, getOrderAmount } from "@/components/checkout/utils";

export const Route = createFileRoute("/shop/checkout/pod-confirmation")({
  component: PODConfirmationPage,
});

// Payment details component specific to POD
const PODPaymentDetails = ({ session }: { session: any }) => {
  const { formatter } = useStoreContext();
  const { checkoutState } = useCheckout();

  if (!session?.paymentMethod) {
    return null;
  }

  const podPaymentMethod = session.paymentMethod?.podPaymentMethod || "cash";

  const items =
    checkoutState.bag?.items?.map((item: any) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      price: item.price,
    })) || [];

  const discount = session?.discount as any;

  const amountCharge = getOrderAmount({
    items,
    discount,
    deliveryFee: (session?.deliveryFee || 0) * 100,
    subtotal: session?.amount || 0,
    isInCents: true,
  });

  const discountValue = getDiscountValue(items, discount);

  const originalAmount =
    (session?.amount || 0) + (session?.deliveryFee || 0) * 100;

  const hasDiscount = discount && discountValue > 0;

  const discountText =
    discount?.type === "percentage"
      ? `${discount.value}%`
      : `${formatter.format(discountValue)}`;

  const discountSpan =
    discount?.span == "entire-order" ? "entire order" : "select items";

  const paymentMethodText =
    podPaymentMethod === "mobile_money"
      ? "Mobile Money on Delivery"
      : "Cash on Delivery";

  const paymentInstructions =
    podPaymentMethod === "mobile_money"
      ? "Our delivery courier will help you complete the mobile money payment when your order arrives."
      : "Please have the exact amount ready when your order arrives.";

  return (
    <div className="space-y-8">
      <p className="text-xs">Payment</p>

      <div className="space-y-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {hasDiscount ? (
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground line-through">
                  {formatter.format(originalAmount / 100)}
                </p>
                <p className="text-sm font-medium">
                  {formatter.format(amountCharge / 100)}
                </p>
              </div>
            ) : (
              <p className="text-sm">{formatter.format(amountCharge / 100)}</p>
            )}
            {discount && (
              <p className="text-sm font-medium">
                {`${discount?.code} - ${discountText}`} off {discountSpan}
              </p>
            )}
          </div>
          <p className="text-sm">Pay on Delivery</p>
        </div>
        <p className="text-sm">{paymentMethodText}</p>
        <p className="text-xs text-muted-foreground mt-2">
          {paymentInstructions}
        </p>
      </div>
    </div>
  );
};

// Pickup/Delivery details component
const PODPickupDetails = ({ session }: { session: any }) => {
  if (session.deliveryMethod == "pickup") {
    return (
      <div className="space-y-8 text-sm">
        <p className="text-xs">Picking up at</p>

        <div className="space-y-2">
          <p className="">Wigclub Hair Studio</p>
          <p className="text-sm text-muted-foreground">
            2 Jungle Ave., East Legon
          </p>
        </div>
      </div>
    );
  }

  if (!session.deliveryDetails) return null;

  return (
    <div className="space-y-8">
      <p className="text-xs">Delivering to</p>

      <DeliveryDetails address={session.deliveryDetails} />

      {session.deliveryInstructions && (
        <p className="text-xs text-muted-foreground mt-2">
          <strong>Instructions:</strong> {session.deliveryInstructions}
        </p>
      )}
    </div>
  );
};

// Order details component for POD
const PODOrderDetails = ({ session }: { session: any }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { ease: "easeOut", duration: 0.8, delay: 1.1 },
      }}
      className="grid grid-cols-1 lg:grid-cols-2 w-full lg:w-[80%] gap-8"
    >
      <PODPickupDetails session={session} />
      <PODPaymentDetails session={session} />
    </motion.div>
  );
};

const PODConfirmationContent = () => {
  const { userId } = useAuth();
  const isGuest = userId === undefined;
  const { checkoutState } = useCheckout();
  const queryClient = useQueryClient();
  const bagQueries = useBagQueries();

  const { data: session, isLoading } = useQuery({
    queryKey: ["active-checkout-session"],
    queryFn: getActiveCheckoutSession,
    retry: false,
  });

  // Complete the checkout session when the component mounts (similar to Paystack flow)
  useEffect(() => {
    const completePODCheckoutSession = async () => {
      if (!session?._id || session.hasCompletedCheckoutSession) return;

      const { data } = webOrderSchema.safeParse(checkoutState);

      try {
        await Promise.all([
          updateCheckoutSession({
            action: "complete-checkout",
            sessionId: session._id,
            hasCompletedCheckoutSession: true,
            orderDetails: data,
          }),

          postAnalytics({
            action: "completed_payment_on_delivery_checkout",
            data: {
              checkoutSessionId: session._id,
              podPaymentMethod: session.paymentMethod?.podPaymentMethod,
            },
          }),
        ]);

        queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
      } catch (error) {
        console.error("Failed to complete POD checkout session:", error);
      }
    };

    // Complete the session if it has a placed order (POD flow doesn't require completed payment)
    if (session && session.placedOrderId) {
      completePODCheckoutSession();
    }
  }, [session, checkoutState, queryClient, bagQueries]);

  if (isLoading || session === undefined) return null;

  if (!session?.placedOrderId) {
    return (
      <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
        <div className="flex flex-col gap-16 mt-24 w-[80%]">
          <div className="space-y-4">
            <p className="text-xl">Order Not Found</p>
            <p className="text-muted-foreground">
              We couldn't find your order confirmation.
            </p>
          </div>

          <Link to="/">
            <Button variant={"clear"} className="px-0">
              Continue Shopping
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isDeliveryOrder = session?.deliveryMethod == "delivery";
  const isPickupOrder = session?.deliveryMethod == "pickup";
  const podPaymentMethod = session.paymentMethod?.podPaymentMethod || "cash";

  return (
    <AnimatePresence>
      <FadeIn className="container mx-auto max-w-[1024px] px-6 xl:px-0 pt-24 pb-40 space-y-24">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.6, delay: 0.3 },
          }}
          className="space-y-12"
        >
          <p className="text-4xl font-light">{`Get excited, ${capitalizeFirstLetter(session.customerDetails?.firstName || "")}!`}</p>

          {isDeliveryOrder && (
            <p>
              We're processing your order. You'll pay{" "}
              {podPaymentMethod === "mobile_money"
                ? "via mobile money"
                : "with cash"}{" "}
              when it's delivered.
            </p>
          )}

          {isPickupOrder && (
            <p>
              We're processing your order. You'll pay{" "}
              {podPaymentMethod === "mobile_money"
                ? "via mobile money"
                : "with cash"}{" "}
              when you pick it up.
            </p>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut", duration: 0.8, delay: 0.9 },
          }}
          className="space-y-8 w-full lg:w-[40%]"
        >
          <p className="text-xs">Your order</p>

          <BagSummaryItems
            items={checkoutState.bag.items}
            discount={session.discount as Discount | null}
          />
        </motion.div>

        <PODOrderDetails session={session} />

        {isGuest && !session.discount && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { ease: "easeOut", duration: 0.8, delay: 1.4 },
            }}
          >
            <GuestRewardsPrompt
              orderAmount={session.amount}
              orderEmail={session.customerDetails?.email || ""}
            />
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4, delay: 1.5 },
          }}
          className="space-x-12 pt-8"
        >
          <Link to="/">
            <Button variant={"clear"} className="px-0">
              Continue shopping
            </Button>
          </Link>

          {session.placedOrderId && (
            <Link
              to="/shop/orders/$orderId"
              params={{ orderId: session.placedOrderId }}
              search={{ origin: "checkout" }}
            >
              <Button variant={"link"}>View order</Button>
            </Link>
          )}
        </motion.div>
      </FadeIn>
    </AnimatePresence>
  );
};

function PODConfirmationPage() {
  return (
    <CheckoutProvider>
      <PODConfirmationContent />
    </CheckoutProvider>
  );
}
