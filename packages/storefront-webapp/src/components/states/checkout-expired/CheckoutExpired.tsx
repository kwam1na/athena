import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { BagSummaryItems } from "@/components/checkout/BagSummary";
import type { Discount } from "@/components/checkout/types";
import { StorefrontPage } from "@/components/common/StorefrontPage";
import { PageState, type PageStateKind } from "@/components/states/PageState";
import { Button } from "@/components/ui/button";
import { useCheckout } from "@/hooks/useCheckout";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";

type CheckoutStatePageProps = {
  state?: PageStateKind;
  title: string;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
};

export function CheckoutStatePage({
  state = "terminal",
  title,
  description,
  primaryAction,
  secondaryAction,
}: CheckoutStatePageProps) {
  return (
    <StorefrontPage as="section" spacing="relaxed">
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
        <PageState
          state={state}
          title={title}
          description={description}
          primaryAction={primaryAction}
          secondaryAction={secondaryAction}
          className="min-h-64 p-0"
        />
      </div>
    </StorefrontPage>
  );
}

const bagAction = (
  <Button asChild>
    <Link to="/shop/bag">Return to bag</Link>
  </Button>
);

const checkoutAction = (
  <Button asChild>
    <Link to="/shop/checkout">Return to checkout</Link>
  </Button>
);

export function CheckoutExpired() {
  return (
    <CheckoutStatePage
      title="Your checkout session has expired"
      description="You were inactive for a while, so we ended the session to keep your information secure."
      primaryAction={bagAction}
    />
  );
}

export function NoCheckoutSession() {
  return (
    <CheckoutStatePage
      state="empty"
      title="No active checkout session"
      description="Add items to your bag when you're ready to begin checkout."
      primaryAction={bagAction}
    />
  );
}

export function CheckoutSessionNotFound() {
  return (
    <CheckoutStatePage
      title="Checkout session not found"
      description="This checkout may have expired or no longer be available."
      primaryAction={bagAction}
    />
  );
}

export function CheckoutSessionGeneric({ message }: { message: string }) {
  return (
    <CheckoutStatePage
      title={message}
      description="Return to checkout to review the current status and next steps."
      primaryAction={checkoutAction}
    />
  );
}

export function UnableToVerifyCheckoutPayment() {
  const { data: activeSession } = useGetActiveCheckoutSession();
  const { checkoutState } = useCheckout();
  const reference =
    activeSession?.externalReference || activeSession?._id || "Unavailable";

  const handleSendEmail = () => {
    const subject = "Support Request: Payment Verification Issue";
    const body = `Reference: ${reference}`;
    window.location.href = `mailto:kwami.nuh@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <StorefrontPage as="section" spacing="relaxed">
      <div className="mx-auto max-w-2xl space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
        <PageState
          state="error"
          title="We couldn't verify your payment"
          description={
            <>
              Try again before starting another checkout. If this continues,{" "}
              <button
                type="button"
                onClick={handleSendEmail}
                className="font-medium text-action underline-offset-4 hover:underline"
              >
                contact support
              </button>
              .
            </>
          }
          inline
          className="p-0"
        />

        {checkoutState.bag.items.length > 0 && (
          <section
            aria-labelledby="verification-order-heading"
            className="space-y-layout-sm border-t border-border pt-layout-lg"
          >
            <h2
              id="verification-order-heading"
              className="text-sm font-medium"
            >
              Your order
            </h2>
            <BagSummaryItems
              items={checkoutState.bag.items}
              discount={activeSession?.discount as Discount | null}
            />
          </section>
        )}

        <p className="break-all text-xs text-muted-foreground">
          Reference: {reference}
        </p>

        <div className="flex flex-wrap gap-layout-sm">
          <Button asChild variant="outline">
            <Link to="/shop/bag">Return to bag</Link>
          </Button>
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    </StorefrontPage>
  );
}

export function CheckoutCompleted() {
  return (
    <CheckoutStatePage
      state="success"
      title="Your checkout is complete"
      description="Your order is already confirmed."
      primaryAction={
        <Button asChild>
          <Link to="/">Continue shopping</Link>
        </Button>
      }
      secondaryAction={
        <Button asChild variant="outline">
          <Link to="/shop/orders">View orders</Link>
        </Button>
      }
    />
  );
}

export function CheckoutMissingPayment() {
  const { activeSession } = useCheckout();
  const reference = activeSession.externalReference || activeSession._id;

  return (
    <CheckoutStatePage
      state="error"
      title="Payment information is missing"
      description={
        <>
          We couldn't find payment for this checkout. Return to checkout or
          contact support with reference <strong>{reference}</strong>.
        </>
      }
      primaryAction={checkoutAction}
    />
  );
}

export function CheckoutNotComplete() {
  return (
    <CheckoutStatePage
      title="This checkout is not complete"
      description="Go back to review the order before continuing."
      primaryAction={
        <Button type="button" onClick={() => window.history.back()}>
          Go back
        </Button>
      }
    />
  );
}
