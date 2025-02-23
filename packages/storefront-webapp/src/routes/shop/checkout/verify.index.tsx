import { verifyCheckoutSessionPayment } from "@/api/checkoutSession";
import { Icons } from "@/components/ui/icons";
import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import {
  CheckoutCompleted,
  UnableToVerifyCheckoutPayment,
} from "@/components/states/checkout-expired/CheckoutExpired";

export const Route = createFileRoute("/shop/checkout/verify/")({
  component: () => <Verify />,
});

const Verify = () => {
  const { userId } = useStoreContext();

  const navigate = useNavigate();

  const { data: session, isLoading } = useGetActiveCheckoutSession();

  const externalReference =
    new URLSearchParams(window.location.search).get("reference") ||
    session?.externalReference;

  const { data } = useQuery({
    queryKey: ["verified-payment"],
    queryFn: () =>
      verifyCheckoutSessionPayment({
        externalReference: externalReference!,
      }),
    enabled: Boolean(userId && externalReference),
  });

  useEffect(() => {
    if (data) {
      if (data.verified || session?.placedOrderId)
        navigate({ to: "/shop/checkout/complete" });
    }
  }, [data, session]);

  if (isLoading || session === undefined) return null;

  if (!externalReference || data?.verified === false) {
    return <UnableToVerifyCheckoutPayment />;
  }

  if (session === null) {
    return <CheckoutCompleted />;
  }

  return (
    <div className="container mx-auto max-w-[1024px] px-6 lg:px-0 flex items-center justify-center min-h-[80vh] p-40">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          transition: { ease: "easeOut", duration: 0.6 },
        }}
        className="space-y-4"
      >
        <div className="flex gap-2 items-center justify-center">
          <Icons.spinner className="ml-2 h-4 w-4 animate-spin" />
          <p className="text-sm">Verifying your payment...</p>
        </div>

        <div className="w-full flex gap-1 text-muted-foreground">
          <p className="text-sm">
            If you are not redirected in the next minute, click
          </p>
          <Link to="/shop/checkout/complete">
            <p className="text-sm underline">here</p>
          </Link>
        </div>
      </motion.div>
    </div>
  );
};
