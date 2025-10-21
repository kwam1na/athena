import { postAnalytics } from "@/api/analytics";
import { updateCheckoutSession } from "@/api/checkoutSession";
import { BagSummaryItems } from "@/components/checkout/BagSummary";
import { CheckoutProvider } from "@/components/checkout/CheckoutProvider";
import { useCheckout } from "@/hooks/useCheckout";
import { Discount } from "@/components/checkout/types";
import { OrderDetails } from "@/components/checkout/OrderDetails";
import { GuestRewardsPrompt } from "@/components/rewards/GuestRewardsPrompt";
import {
  CheckoutCompleted,
  UnableToVerifyCheckoutPayment,
} from "@/components/states/checkout-expired/CheckoutExpired";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { useAuth } from "@/hooks/useAuth";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useBagQueries } from "@/lib/queries/bag";
import { capitalizeFirstLetter } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { webOrderSchema } from "@/components/checkout/CheckoutProvider";

export const Route = createFileRoute("/shop/checkout/complete/")({
  component: () => <CheckoutCompleteView />,
});

export const CheckoutComplete = () => {
  const { checkoutState, activeSession, onlineOrder } = useCheckout();
  const { bag } = useShoppingBag();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const bagQueries = useBagQueries();

  const [hasOrderError, setHasOrderError] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const isGuest = userId === undefined;

  useEffect(() => {
    const completeCheckoutSession = async () => {
      if (
        !activeSession.hasCompletedPayment &&
        !activeSession.hasVerifiedPayment
      ) {
        return;
      }

      const { data } = webOrderSchema.safeParse(checkoutState);

      try {
        await Promise.allSettled([
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
      } catch (error) {
        console.error("Failed to complete checkout:", error);
        setHasOrderError(true);
      }
    };

    completeCheckoutSession();
  }, [
    activeSession._id,
    activeSession.hasCompletedPayment,
    activeSession.hasVerifiedPayment,
  ]);

  const retryOrderCreation = async () => {
    const { data } = webOrderSchema.safeParse(checkoutState);
    setIsRetrying(true);
    setHasOrderError(false);

    try {
      await updateCheckoutSession({
        action: "complete-checkout",
        sessionId: activeSession._id,
        hasCompletedCheckoutSession: true,
        orderDetails: data,
      });

      queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
    } catch (error) {
      console.error("Failed to retry order creation:", error);
      setHasOrderError(true);
    } finally {
      setIsRetrying(false);
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
        <UnableToVerifyCheckoutPayment />
      </motion.div>
    );
  }

  if (hasOrderError) {
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
            isLoading={isRetrying}
            onClick={retryOrderCreation}
            className="w-[240px]"
          >
            Try again
          </LoadingButton>
        </motion.div>
      </div>
    );
  }

  const bagItems = onlineOrder?.items || checkoutState.bag.items;
  const hasBagItems = (bag?.items?.length ?? 0) > 0;

  const deliveryMessage =
    activeSession.deliveryMethod === "delivery"
      ? "Your order will be processed in 24 - 48 hours. We'll email you when it's out for delivery."
      : "Your order will be processed in 24 - 48 hours. We'll email you when it's ready for pickup.";

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
          <CardTitle className="text-3xl font-light">
            {`Get excited, ${capitalizeFirstLetter(activeSession.customerDetails?.firstName || "")}!`}
          </CardTitle>
          <p>{deliveryMessage}</p>
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
          <BagSummaryItems
            items={bagItems}
            discount={activeSession.discount as Discount | null}
          />
        </motion.div>

        <OrderDetails session={activeSession} delayAnimation />

        {isGuest && !activeSession.discount && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { ease: "easeOut", duration: 0.8, delay: 1.4 },
            }}
          >
            <GuestRewardsPrompt
              orderAmount={activeSession.amount}
              orderEmail={activeSession.customerDetails?.email || ""}
            />
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4, delay: 1.5 },
          }}
          className="flex flex-col gap-4 md:gap-8 lg:flex-row pt-8"
        >
          {!hasBagItems && (
            <Link to="/">
              <Button variant="clear" className="px-0">
                Continue shopping
              </Button>
            </Link>
          )}

          {hasBagItems && (
            <Link to="/shop/bag">
              <Button variant="clear" className="group px-0">
                <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
                Return to bag
              </Button>
            </Link>
          )}

          {activeSession.placedOrderId && (
            <Link
              to="/shop/orders/$orderId"
              params={{ orderId: activeSession.placedOrderId }}
              search={{ origin: "checkout" }}
            >
              <Button variant="link" className="px-0">
                View order
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

  if (isLoading || data === undefined) {
    return null;
  }

  if (data === null) {
    return <CheckoutCompleted />;
  }

  return (
    <CheckoutProvider>
      <CheckoutComplete />
    </CheckoutProvider>
  );
};
