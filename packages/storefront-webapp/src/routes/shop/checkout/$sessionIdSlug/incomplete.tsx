import { BagSummaryItems } from "@/components/checkout/BagSummary";
import { CheckoutProvider } from "@/components/checkout/CheckoutProvider";
import { useCheckout } from "@/hooks/useCheckout";
import { Address, Discount } from "@/components/checkout/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useStoreContext } from "@/contexts/StoreContext";
import {
  formatDeliveryAddress,
  getOrderAmount,
} from "@/components/checkout/utils";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { CardTitle } from "@/components/ui/card";

export const Route = createFileRoute(
  "/shop/checkout/$sessionIdSlug/incomplete"
)({
  component: () => <CheckoutIncomplete />,
});

function CheckoutIncompleteView() {
  const { onlineOrder } = useCheckout();
  const { formatter } = useStoreContext();

  const { amountCharged, amountPaid } = getOrderAmount({
    items: onlineOrder?.items || ([] as any),
    discount: onlineOrder?.discount as Discount | null,
    deliveryFee: (onlineOrder?.deliveryFee || 0) * 100,
    subtotal: onlineOrder?.amount || 0,
    isInCents: true,
  });

  const { addressLine } = formatDeliveryAddress(
    onlineOrder?.deliveryDetails as Address
  );

  useTrackEvent({
    action: "viewed_checkout_incomplete_screen",
    data: {
      order_id: onlineOrder?._id,
      checkout_session_id: onlineOrder?.checkoutSessionId,
    },
  });

  return (
    <AnimatePresence>
      {onlineOrder && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ease: "easeOut", duration: 0.4 }}
          className="container mx-auto max-w-[1024px] h-full flex justify-center"
        >
          <div className="flex flex-col gap-16 mt-24 w-[80%]">
            <div className="space-y-16">
              <div className="space-y-4">
                <p className="text-2xl">Your last order was not completed</p>
                <p>Your payment is confirmed. Let's finalize your order</p>
              </div>

              {onlineOrder?._creationTime && (
                <div className="flex flex-col md:flex-row gap-4 text-sm">
                  <p>{`Order #${onlineOrder?.orderNumber}`}</p>
                  <p className="hidden md:block">·</p>
                  <p>
                    {onlineOrder?.deliveryMethod === "delivery"
                      ? "Delivery to"
                      : "In-store pickup"}{" "}
                    {addressLine}
                  </p>
                  <p className="hidden md:block">·</p>
                  {onlineOrder?._creationTime && (
                    <p>Placed {formatDate(onlineOrder?._creationTime)}</p>
                  )}
                </div>
              )}

              <div className="w-full lg:w-[40%] space-y-8">
                <BagSummaryItems
                  items={onlineOrder?.items || ([] as any)}
                  discount={onlineOrder?.discount as Discount | null}
                />
              </div>

              <Badge variant={"outline"}>
                <div className="flex gap-8">
                  <div className="flex items-center gap-1">
                    <p className="font-light">Subtotal</p>
                    <p className="font-medium">
                      {formatter.format(amountPaid / 100)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <p className="font-light">Delivery</p>
                    <p className="font-medium">
                      {formatter.format(onlineOrder?.deliveryFee || 0 / 100)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <p className="font-light">Paid</p>
                    <p className="font-medium">
                      {formatter.format(amountCharged / 100)}
                    </p>
                  </div>
                </div>
              </Badge>
            </div>

            <Link
              to={"/shop/checkout/verify"}
              search={{ reference: onlineOrder?.externalReference }}
            >
              <Button variant={"clear"} className="group px-0">
                Finish now
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const CheckoutIncomplete = () => {
  return (
    <CheckoutProvider>
      <CheckoutIncompleteView />
    </CheckoutProvider>
  );
};
