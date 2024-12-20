import { updateCheckoutSession } from "@/api/checkoutSession";
import { BagSummaryItems } from "@/components/checkout/BagSummary";
import {
  CheckoutProvider,
  useCheckout,
  webOrderSchema,
} from "@/components/checkout/CheckoutProvider";
import { DeliveryDetails } from "@/components/checkout/DeliveryDetails/DeliverySection";
import { CheckoutCompleted } from "@/components/states/checkout-expired/CheckoutExpired";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import { capitalizeFirstLetter } from "@/lib/utils";
import { bagQueries } from "@/queries";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

export const Route = createFileRoute("/shop/checkout/complete/")({
  component: () => <CheckoutCompleteView />,
});

const PickupDetails = () => {
  const { checkoutState } = useCheckout();

  if (checkoutState.isPickupOrder) {
    return (
      <div className="space-y-8">
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

  return (
    <div className="space-y-8">
      <p className="text-xs">Delivering to</p>

      <DeliveryDetails />
    </div>
  );
};

const CheckoutComplete = () => {
  const { checkoutState, activeSession } = useCheckout();
  const { userId, storeId, organizationId } = useStoreContext();

  const queryClient = useQueryClient();

  useEffect(() => {
    const completeCheckoutSession = async () => {
      const { data } = webOrderSchema.safeParse(checkoutState);

      console.log("details ->", data);

      if (data) {
        console.log("updating with details...");
        await updateCheckoutSession({
          action: "complete-checkout",
          organizationId,
          storeId,
          customerId: userId!,
          sessionId: activeSession._id,
          hasCompletedCheckoutSession: true,
          orderDetails: data,
        });

        queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
      }
    };

    if (activeSession && userId) {
      completeCheckoutSession();
    }
  }, [activeSession]);

  return (
    <AnimatePresence>
      <div className="px-48 pt-24 pb-40 space-y-24">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.6, delay: 0.3 },
          }}
          className="space-y-12"
        >
          <p className="text-4xl font-light">{`Get excited, ${capitalizeFirstLetter(checkoutState.customerDetails?.firstName || "")}!`}</p>

          {checkoutState.isDeliveryOrder && (
            <p>
              We're processing your order. You will receive an email once it is
              out for delivery.
            </p>
          )}

          {checkoutState.isPickupOrder && (
            <p>
              We're processing your order. You will receive an email once it is
              ready for pickup.
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
          className="space-y-8 w-[30%]"
        >
          <p className="text-xs">Your order</p>

          <BagSummaryItems />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut", duration: 0.8, delay: 1.1 },
          }}
          className="grid grid-cols-2 w-[80%]"
        >
          <PickupDetails />

          <div className="space-y-8">
            <p className="text-xs">Payment</p>

            <p>MTN Momo</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4, delay: 1.5 },
          }}
          className="space-x-12 pt-8"
        >
          <Link>
            <Button className="w-[240px]">Continue shopping</Button>
          </Link>

          <Link>
            <Button variant={"link"}>View order</Button>
          </Link>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

const CheckoutCompleteView = () => {
  const { data, isLoading } = useGetActiveCheckoutSession();

  if (isLoading || !data) return null;

  if (data?.message?.includes("No active session found")) {
    return <CheckoutCompleted />;
  }

  return (
    <CheckoutProvider>
      <CheckoutComplete />
    </CheckoutProvider>
  );
};
