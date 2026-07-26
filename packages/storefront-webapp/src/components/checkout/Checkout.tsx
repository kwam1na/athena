import { CheckoutProvider } from "./CheckoutProvider";
import BagSummary from "./BagSummary";
import { useEffect, useRef } from "react";
import MobileBagSummary from "./MobileBagSummary";
import { CheckoutForm } from "./CheckoutForm";
import { TrustSignals } from "../communication/TrustSignals";
import { useNavigate } from "@tanstack/react-router";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import { createCheckoutDetailsViewedEvent } from "@/lib/storefrontJourneyEvents";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";

const MainComponent = () => {
  const { data: activeSession } = useGetActiveCheckoutSession();
  const navigate = useNavigate();
  const { track } = useStorefrontObservability();
  const lastTrackedCheckoutSession = useRef<string | null>(null);

  useEffect(() => {
    if (!activeSession?._id) return;
    if (lastTrackedCheckoutSession.current === activeSession._id) return;

    lastTrackedCheckoutSession.current = activeSession._id;

    void track(
      createCheckoutDetailsViewedEvent({
        checkoutSessionId: activeSession._id,
      }),
    ).catch((error) => {
      console.error("Failed to track checkout details view:", error);
    });
  }, [activeSession?._id, track]);

  useEffect(() => {
    const origin = new URLSearchParams(window.location.search).get("origin");

    if (!activeSession) return;

    // Payment is settled if EITHER the Paystack webhook completed it or the
    // client verified it against Paystack.
    const hasSettledPayment =
      activeSession.hasCompletedPayment || activeSession.hasVerifiedPayment;

    const needsVerification =
      activeSession.externalReference &&
      hasSettledPayment &&
      activeSession.placedOrderId &&
      origin === "paystack";

    const isIncomplete =
      hasSettledPayment &&
      activeSession.placedOrderId &&
      !activeSession.hasCompletedCheckoutSession &&
      origin === null;

    if (needsVerification) {
      navigate({
        to: `/shop/checkout/verify?reference=${activeSession.externalReference}`,
      });
    }

    if (isIncomplete) {
      navigate({
        to: `/shop/checkout/${activeSession._id}/incomplete`,
      });
    }
  }, [activeSession]);

  return (
    <section
      data-testid="storefront-checkout-ready"
      aria-labelledby="checkout-heading"
      className="grid min-h-dvh w-full grid-cols-1 bg-canvas md:grid-cols-12"
    >
      <div className="order-2 px-gutter py-layout-xl md:order-1 md:col-span-7 lg:px-layout-3xl">
        <div className="mx-auto max-w-2xl space-y-layout-xl">
          <header className="space-y-layout-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Secure checkout
            </p>
            <h1
              id="checkout-heading"
              className="font-display text-3xl font-medium text-foreground"
            >
              Checkout
            </h1>

            <TrustSignals />
          </header>

          <CheckoutForm />
        </div>
      </div>

      <aside
        aria-label="Order summary"
        className="order-1 border-b border-border bg-surface-subtle px-gutter md:order-2 md:col-span-5 md:border-b-0 md:border-l"
      >
        <div className="md:hidden">
          <MobileBagSummary />
        </div>

        <div className="hidden md:block">
          <div className="sticky top-0 flex min-h-dvh items-start justify-center py-layout-3xl">
            <BagSummary />
          </div>
        </div>
      </aside>
    </section>
  );
};

export const Checkout = () => {
  return (
    <CheckoutProvider>
      <MainComponent />
    </CheckoutProvider>
  );
};
