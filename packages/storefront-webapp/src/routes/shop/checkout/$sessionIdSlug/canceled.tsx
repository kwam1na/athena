import { FadeIn } from "@/components/common/FadeIn";
import {
  CheckoutNotComplete,
  CheckoutSessionGeneric,
  CheckoutSessionNotFound,
} from "@/components/states/checkout-expired/CheckoutExpired";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { checkoutSessionQueries } from "@/lib/queries/checkout";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

export const Route = createFileRoute("/shop/checkout/$sessionIdSlug/canceled")({
  component: () => <CheckoutCanceledView />,
});

const CheckoutCanceledView = () => {
  const { sessionIdSlug } = useParams({ strict: false });

  const {
    data: sessionData,
    isLoading,
    isRefetching,
  } = useQuery(checkoutSessionQueries.session(sessionIdSlug));

  if ((!sessionData && isLoading) || isRefetching) return null;

  if ((!sessionData && !isLoading) || !sessionData?.isPaymentRefunded) {
    return (
      <CheckoutSessionGeneric message="This checkout session no longer exists or has been canceled" />
    );
  }

  return (
    <AnimatePresence>
      <FadeIn className="container mx-auto max-w-[1024px] px-6 xl:px-0 pt-24 pb-40 space-y-24">
        <motion.div className="space-y-12">
          <p className="text-4xl font-light">Your order has been canceled</p>

          <p className="text-sm">
            Please allow 7 - 12 days for your refund to be processed.
          </p>
        </motion.div>

        <motion.div className="space-x-8 pt-8">
          <Link to="/">
            <Button className="w-[240px]">Continue shopping</Button>
          </Link>

          <Link to="/shop/bag">
            <Button variant={"link"} className="w-[240px]">
              View Bag
            </Button>
          </Link>
        </motion.div>
      </FadeIn>
    </AnimatePresence>
  );
};
