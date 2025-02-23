import { BagSummaryItems } from "@/components/checkout/BagSummary";
import {
  PaymentDetails,
  PickupDetails,
} from "@/components/checkout/OrderDetails";
import { FadeIn } from "@/components/common/FadeIn";
import {
  CheckoutNotComplete,
  CheckoutSessionGeneric,
} from "@/components/states/checkout-expired/CheckoutExpired";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckoutSessionQueries } from "@/lib/queries/checkout";
import { capitalizeFirstLetter } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

export const Route = createFileRoute("/shop/checkout/$sessionIdSlug/complete")({
  component: () => <CheckoutCompleteView />,
});

const CheckoutCompleteView = () => {
  const { sessionIdSlug } = useParams({ strict: false });

  const checkoutSessionQueries = useCheckoutSessionQueries();

  const { data: sessionData, isLoading } = useQuery(
    checkoutSessionQueries.session(sessionIdSlug)
  );

  if (!sessionData && isLoading) return null;

  if (!sessionData && !isLoading) {
    return (
      <CheckoutSessionGeneric message="This checkout session does not exist" />
    );
  }

  if (!sessionData?.placedOrderId) {
    return <CheckoutNotComplete />;
  }

  const isDeliveryOrder = sessionData?.deliveryMethod == "delivery";
  const isPickupOrder = sessionData?.deliveryMethod == "pickup";

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
          <Link to="/">
            <Button variant={"clear"} className="px-0">
              Continue shopping
            </Button>
          </Link>

          <Link
            to="/shop/orders/$orderId"
            params={{ orderId: sessionData.placedOrderId }}
          >
            <Button variant={"link"}>View order</Button>
          </Link>
        </motion.div>
      </FadeIn>
    </AnimatePresence>
  );
};
