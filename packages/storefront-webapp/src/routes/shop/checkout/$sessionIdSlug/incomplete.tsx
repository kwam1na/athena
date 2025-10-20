import { BagSummaryItems } from "@/components/checkout/BagSummary";
import {
  CheckoutProvider,
  Discount,
  useCheckout,
} from "@/components/checkout/CheckoutProvider";
import { CheckoutSessionGeneric } from "@/components/states/checkout-expired/CheckoutExpired";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/ui/icons";
import { formatDate } from "@/lib/utils";
import { ProductSku } from "@athena/webapp";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useStoreContext } from "@/contexts/StoreContext";

export const Route = createFileRoute(
  "/shop/checkout/$sessionIdSlug/incomplete"
)({
  component: () => <CheckoutIncomplete />,
});

function CheckoutIncompleteView() {
  const { onlineOrder } = useCheckout();
  const { formatter } = useStoreContext();

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

              <div className="w-full lg:w-[40%] space-y-8">
                <BagSummaryItems
                  items={onlineOrder?.items || ([] as any)}
                  discount={onlineOrder?.discount as Discount | null}
                />
                <Badge variant={"outline"}>
                  Paid {formatter.format((onlineOrder?.amount || 0) / 100)}
                </Badge>
              </div>

              {onlineOrder?._creationTime && (
                <div className="flex gap-4 text-sm">
                  <p>{`Order #${onlineOrder?.orderNumber}`}</p>
                  <p>·</p>
                  {onlineOrder?._creationTime && (
                    <p>Placed {formatDate(onlineOrder?._creationTime)}</p>
                  )}
                </div>
              )}
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
