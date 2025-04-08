import { postAnalytics } from "@/api/analytics";
import { updateCheckoutSession } from "@/api/checkoutSession";
import { BagSummaryItems } from "@/components/checkout/BagSummary";
import {
  CheckoutProvider,
  useCheckout,
  webOrderSchema,
} from "@/components/checkout/CheckoutProvider";
import { OrderDetails } from "@/components/checkout/OrderDetails";
import {
  CheckoutCompleted,
  UnableToVerifyCheckoutPayment,
} from "@/components/states/checkout-expired/CheckoutExpired";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import { useBagQueries } from "@/lib/queries/bag";
import { capitalizeFirstLetter } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { act, useEffect, useState } from "react";

export const Route = createFileRoute("/shop/checkout/complete/")({
  component: () => <CheckoutCompleteView />,
});

export const CheckoutComplete = () => {
  const { checkoutState, activeSession } = useCheckout();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [attemptedOrderCreation, setAttemptedOrderCreation] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

  const queryClient = useQueryClient();

  const bagQueries = useBagQueries();

  useEffect(() => {
    const completeCheckoutSession = async () => {
      const { data } = webOrderSchema.safeParse(checkoutState);

      if (
        activeSession.hasCompletedPayment ||
        activeSession.hasVerifiedPayment
      ) {
        await Promise.all([
          updateCheckoutSession({
            action: "complete-checkout",
            sessionId: activeSession._id,
            hasCompletedCheckoutSession: true,
            orderDetails: data,
          }),

          postAnalytics({
            action: "completed_checkout",
            data: {
              checkoutSessionId: activeSession._id,
            },
          }),
        ]);

        queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
      }
    };

    if (activeSession) {
      completeCheckoutSession();
    }
  }, [activeSession]);

  const placeOrder = async () => {
    const { data } = webOrderSchema.safeParse(checkoutState);
    setAttemptedOrderCreation(false);

    try {
      setIsPlacingOrder(true);

      const res = await updateCheckoutSession({
        action: "complete-checkout",
        sessionId: activeSession._id,
        hasCompletedCheckoutSession: true,
        orderDetails: data,
      });

      setOrderId(res.orderId);
      setAttemptedOrderCreation(true);
      setIsPlacingOrder(false);

      queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
    } catch (e) {
      setIsPlacingOrder(false);
    }
  };

  if (!activeSession.hasCompletedPayment && !activeSession.hasVerifiedPayment) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          transition: { ease: "easeOut", duration: 0.4 },
        }}
      >
        <UnableToVerifyCheckoutPayment />
      </motion.div>
    );
  }

  if ((!orderId && attemptedOrderCreation) || isPlacingOrder) {
    console.log("returning issue order");
    return (
      <div className="px-48 pt-24 pb-40 space-y-24">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.6, delay: 0.3 },
          }}
          className="space-y-12"
        >
          <p className="text-xl font-light">
            There was an issue finalizing your order
          </p>

          <p className="text-xs">{`Session id: ${activeSession._id}`}</p>

          <LoadingButton
            isLoading={isPlacingOrder}
            onClick={placeOrder}
            className="w-[240px]"
          >
            Try again
          </LoadingButton>
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <div className="container mx-auto max-w-[1024px] pt-24 pb-40 px-6 lg:px-0 space-y-24">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.6, delay: 0.3 },
          }}
          className="space-y-12"
        >
          <p className="text-3xl font-light">{`Get excited, ${capitalizeFirstLetter(activeSession.customerDetails?.firstName || "")}!`}</p>

          {activeSession.deliveryMethod == "delivery" && (
            <p>
              Your order will be processed in 24 - 48 hours. We'll email you
              when it's out for delivery.
            </p>
          )}

          {activeSession.deliveryMethod == "pickup" && (
            <p>
              Your order will be processed in 24 - 48 hours. We'll email you
              when it's ready for pickup.
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
          <BagSummaryItems items={checkoutState.bag.items} />
        </motion.div>

        <OrderDetails session={activeSession} delayAnimation />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4, delay: 1.5 },
          }}
          className="flex flex-col gap-4 md:gap-8 lg:flex-row pt-8"
        >
          <Link to="/">
            <Button variant={"clear"} className="px-0">
              Continue shopping
            </Button>
          </Link>

          {activeSession.placedOrderId && (
            <Link
              to="/shop/orders/$orderId"
              params={{ orderId: activeSession.placedOrderId }}
              search={{ origin: "checkout" }}
            >
              <Button variant={"link"} className="px-0">
                <p className="w-full text-center">View order</p>
              </Button>
            </Link>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

const CheckoutCompleteView = () => {
  const { data, isLoading } = useGetActiveCheckoutSession();

  if (isLoading || data === undefined) return null;

  if (data == null) {
    return <CheckoutCompleted />;
  }

  return (
    <CheckoutProvider>
      <CheckoutComplete />
    </CheckoutProvider>
  );
};
