import { updateCheckoutSession } from "@/api/checkoutSession";
import { BagSummaryItems } from "@/components/checkout/BagSummary";
import {
  CheckoutProvider,
  useCheckout,
  webOrderSchema,
} from "@/components/checkout/CheckoutProvider";
import { DeliveryDetails } from "@/components/checkout/DeliveryDetails/DeliverySection";
import {
  CheckoutCompleted,
  CheckoutMissingPayment,
} from "@/components/states/checkout-expired/CheckoutExpired";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import { capitalizeFirstLetter } from "@/lib/utils";
import { bagQueries } from "@/queries";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/shop/checkout/complete/")({
  component: () => <CheckoutCompleteView />,
});

const PickupDetails = () => {
  const { checkoutState } = useCheckout();

  if (checkoutState.isPickupOrder) {
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

  if (!checkoutState.deliveryDetails) return null;

  return (
    <div className="space-y-8">
      <p className="text-xs">Delivering to</p>

      <DeliveryDetails address={checkoutState.deliveryDetails} />
    </div>
  );
};

const PaymentDetails = () => {
  const { activeSession } = useCheckout();

  if (!activeSession?.paymentMethod) {
    return null;
  }

  const { paymentMethod } = activeSession;

  const text =
    paymentMethod?.channel == "mobile_money"
      ? `${paymentMethod?.bank} Mobile Money ending in ${paymentMethod?.last4}`
      : `Card ending in ${paymentMethod?.last4}`;

  return (
    <div className="space-y-8">
      <p className="text-xs">Payment</p>

      <p className="text-sm">{text}</p>
    </div>
  );
};

const CheckoutComplete = () => {
  const { checkoutState, activeSession } = useCheckout();
  const { userId, storeId, organizationId } = useStoreContext();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [attemptedOrderCreation, setAttemptedOrderCreation] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    const completeCheckoutSession = async () => {
      const { data } = webOrderSchema.safeParse(checkoutState);

      if (data && activeSession.hasCompletedPayment) {
        const res = await updateCheckoutSession({
          action: "complete-checkout",
          organizationId,
          storeId,
          storeFrontUserId: userId!,
          sessionId: activeSession._id,
          hasCompletedCheckoutSession: true,
          orderDetails: data,
        });

        setOrderId(res.orderId);
        setAttemptedOrderCreation(true);

        queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });

        // sessionStorage.removeItem("checkoutState");
      }
    };

    if (activeSession && userId) {
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
        organizationId,
        storeId,
        storeFrontUserId: userId!,
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

  if (!activeSession.hasCompletedPayment) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          transition: { ease: "easeOut", duration: 0.4 },
        }}
      >
        <CheckoutMissingPayment />
      </motion.div>
    );
  }

  if ((!orderId && attemptedOrderCreation) || isPlacingOrder) {
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

  if (!orderId && !attemptedOrderCreation) return null;

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
          <p className="text-3xl font-light">{`Get excited, ${capitalizeFirstLetter(checkoutState.customerDetails?.firstName || "")}!`}</p>

          {checkoutState.isDeliveryOrder && (
            <p className="text-sm">
              Your order will be processed in 24 - 48 hours. We'll email you
              when it's out for delivery.
            </p>
          )}

          {checkoutState.isPickupOrder && (
            <p className="text-sm">
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
          {/* <p className="text-xs">Your order</p> */}

          <BagSummaryItems items={checkoutState.bag.items} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut", duration: 0.8, delay: 1.1 },
          }}
          className="grid grid-cols-1 lg:grid-cols-2 w-full lg:w-[80%] gap-8"
        >
          <PickupDetails />

          <PaymentDetails />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4, delay: 1.5 },
          }}
          className="flex flex-col gap-4 lg:flex-row pt-8"
        >
          <Link to="/">
            <Button className="w-full lg:w-[240px]">Continue shopping</Button>
          </Link>

          {orderId && (
            <Link to="/shop/orders/$orderId" params={{ orderId }}>
              <Button className="w-full lg:w-[240px]" variant={"clear"}>
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
