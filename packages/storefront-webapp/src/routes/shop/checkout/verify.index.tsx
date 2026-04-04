import { verifyCheckoutSessionPayment } from "@/api/checkoutSession";
import { Icons } from "@/components/ui/icons";
import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import {
  CheckoutCompleted,
  UnableToVerifyCheckoutPayment,
} from "@/components/states/checkout-expired/CheckoutExpired";
import { CheckoutProvider } from "@/components/checkout/CheckoutProvider";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import { createPaymentVerificationStartedEvent } from "@/lib/storefrontJourneyEvents";

export const Route = createFileRoute("/shop/checkout/verify/")({
  component: () => <VerifyCheckoutSessionPayment />,
});

const Verify = () => {
  const navigate = useNavigate();
  const { track } = useStorefrontObservability();
  const lastTrackedVerification = useRef<string | null>(null);

  const { data: session, isLoading } = useGetActiveCheckoutSession();

  const externalReference =
    new URLSearchParams(window.location.search).get("reference") ||
    session?.externalReference;

  const { data } = useQuery({
    queryKey: ["verified-payment", externalReference],
    queryFn: () =>
      verifyCheckoutSessionPayment({
        externalReference: externalReference!,
      }),
    enabled: Boolean(externalReference),
  });

  useEffect(() => {
    const verificationKey = `${session?._id ?? "unknown"}:${externalReference ?? ""}`;

    if (!externalReference || lastTrackedVerification.current === verificationKey)
      return;

    lastTrackedVerification.current = verificationKey;

    void track(
      createPaymentVerificationStartedEvent({
        checkoutSessionId: session?._id,
        externalReference,
      }),
    ).catch((error) => {
      console.error("Failed to track checkout payment verification:", error);
    });
  }, [externalReference, session?._id, track]);

  useEffect(() => {
    if (
      data &&
      externalReference === session?.externalReference &&
      (data.verified || session?.placedOrderId || session?.hasVerifiedPayment)
    ) {
      navigate({ to: "/shop/checkout/complete" });
    }
  }, [data, session, externalReference]);

  if (isLoading || session === undefined) return null;

  if (!externalReference) {
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

const VerifyCheckoutSessionPayment = () => {
  return (
    <CheckoutProvider>
      <Verify />
    </CheckoutProvider>
  );
};
