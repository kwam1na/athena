import { BagSummaryItems } from "@/components/checkout/BagSummary";
import { Checkout } from "@/components/checkout/Checkout";
import {
  PaymentDetails,
  PickupDetails,
} from "@/components/checkout/OrderDetails";
import { CheckoutNotComplete } from "@/components/states/checkout-expired/CheckoutExpired";
import NotFound from "@/components/states/not-found/NotFound";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { capitalizeFirstLetter } from "@/lib/utils";
import { checkoutSessionQueries } from "@/queries";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

export const Route = createFileRoute("/shop/checkout/$sessionIdSlug/complete")({
  component: () => <CheckoutCompleteView />,
});

const CheckoutCompleteView = () => {
  const { sessionIdSlug } = useParams({ strict: false });

  const { userId, organizationId, storeId } = useStoreContext();

  const { data: sessionData, isLoading } = useQuery(
    checkoutSessionQueries.session({
      sessionId: sessionIdSlug,
      userId: userId!,
      organizationId,
      storeId,
    })
  );

  if (!sessionData && isLoading) return null;

  if (!sessionData && !isLoading) {
    return null;
  }

  if (!sessionData.placedOrderId) {
    return <CheckoutNotComplete />;
  }

  const isDeliveryOrder = sessionData.deliveryMethod == "delivery";
  const isPickupOrder = sessionData.deliveryMethod == "pickup";

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
          <p className="text-4xl font-light">{`Get excited, ${capitalizeFirstLetter(sessionData.customerDetails?.firstName || "")}!`}</p>

          {isDeliveryOrder && (
            <p className="text-sm">
              We're processing your order. You will receive an email once it is
              out for delivery.
            </p>
          )}

          {isPickupOrder && (
            <p className="text-sm">
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
          className="space-y-8 w-[40%]"
        >
          <p className="text-xs">Your order</p>

          <BagSummaryItems items={sessionData.items} />
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
          <PickupDetails session={sessionData} />

          <PaymentDetails session={sessionData} />
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

          <Link
            to="/shop/orders/$orderId"
            params={{ orderId: sessionData.placedOrderId }}
          >
            <Button variant={"clear"}>View order</Button>
          </Link>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
