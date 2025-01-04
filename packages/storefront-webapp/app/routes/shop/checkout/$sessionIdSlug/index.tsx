import { updateCheckoutSession } from "@/api/checkoutSession";
import { BagSummaryItems } from "@/components/checkout/BagSummary";
import {
  PaymentDetails,
  PickupDetails,
} from "@/components/checkout/OrderDetails";
import NotFound from "@/components/states/not-found/NotFound";
import { LoadingButton } from "@/components/ui/loading-button";
import { useStoreContext } from "@/contexts/StoreContext";
import { capitalizeFirstLetter } from "@/lib/utils";
import { checkoutSessionQueries } from "@/queries";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

export const Route = createFileRoute("/shop/checkout/$sessionIdSlug/")({
  component: () => <CheckoutSession />,
});

const CheckoutSession = () => {
  const { sessionIdSlug } = useParams({ strict: false });

  const { userId, organizationId, storeId } = useStoreContext();
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

  const {
    data: sessionData,
    isLoading,
    error,
  } = useQuery(
    checkoutSessionQueries.session({
      sessionId: sessionIdSlug,
      userId: userId!,
      organizationId,
      storeId,
    })
  );

  const placeOrder = async () => {
    // setAttemptedOrderCreation(false);

    if (!sessionData || !sessionIdSlug) return;

    try {
      setIsPlacingOrder(true);

      const res = await updateCheckoutSession({
        action: "place-order",
        organizationId,
        storeId,
        storeFrontUserId: userId!,
        sessionId: sessionIdSlug,
        hasCompletedCheckoutSession: true,
      });

      if (res.orderId) {
        window.location.href = `/shop/checkout/${sessionIdSlug}/complete`;
      }

      // setOrderId(res.orderId);
      // setAttemptedOrderCreation(true);
      setIsPlacingOrder(false);

      // queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
    } catch (e) {
      setIsPlacingOrder(false);
    }
  };

  if (!sessionData && isLoading) return null;

  if (!sessionData && !isLoading) {
    return null;
  }

  return (
    <AnimatePresence>
      <div className="px-48 pt-24 pb-40 space-y-24">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut" },
          }}
          className="space-y-12"
        >
          <p className="text-4xl font-light">{`Almost there, ${capitalizeFirstLetter(sessionData?.customerDetails?.firstName || "")}`}</p>

          <p className="text-sm">
            Confirm everything looks good to proceed with your order
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut" },
          }}
          className="space-y-8 w-[40%]"
        >
          <p className="text-xs">Your order</p>

          <BagSummaryItems items={sessionData?.items} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut" },
          }}
          className="grid grid-cols-2 w-[80%]"
        >
          <PickupDetails session={sessionData} />

          <PaymentDetails session={sessionData} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut" },
          }}
          className="space-x-12 pt-8"
        >
          <LoadingButton
            isLoading={isPlacingOrder}
            onClick={placeOrder}
            className="w-[240px]"
          >
            Submit order
          </LoadingButton>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
