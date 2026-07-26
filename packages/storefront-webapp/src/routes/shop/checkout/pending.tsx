import { CheckoutProvider } from "@/components/checkout/CheckoutProvider";
import { FadeIn } from "@/components/common/FadeIn";
import { useStoreContext } from "@/contexts/StoreContext";
import { useCheckoutSessionQueries } from "@/lib/queries/checkout";
import { formatStoredAmount } from "@/lib/currency";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageState } from "@/components/states/PageState";

export const Route = createFileRoute("/shop/checkout/pending")({
  component: () => <PendingOrders />,
});

const Pending = () => {
  const { formatter } = useStoreContext();

  const checkoutSessionQueries = useCheckoutSessionQueries();

  const { data: pendingOrders, isLoading } = useQuery(
    checkoutSessionQueries.pendingSessions()
  );

  if (isLoading) {
    return <PageState state="loading" title="Loading pending orders" />;
  }

  if (!pendingOrders?.length) {
    return (
      <PageState
        state="empty"
        title="No pending orders"
        description="Orders that still need your attention will appear here."
      />
    );
  }

  return (
    <FadeIn className="mx-auto min-h-dvh w-full max-w-content space-y-layout-xl px-gutter py-layout-xl">
      <h1 className="font-display text-3xl font-medium">Pending orders</h1>

      <div className="grid grid-cols-1 gap-layout-sm">
        {pendingOrders?.map((session: any) => {
          return (
            <Link
              to="/shop/checkout/$sessionIdSlug"
              params={{ sessionIdSlug: session._id }}
              key={session._id}
              className="flex min-h-control-standard items-center justify-between rounded-lg border border-border bg-surface p-layout-sm shadow-surface transition-colors duration-fast hover:bg-selection"
            >
              <p className="text-sm font-medium">{`${formatStoredAmount(formatter, session.amount)} order placed on ${new Date(session._creationTime).toDateString()}`}</p>
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
          );
        })}
      </div>
    </FadeIn>
  );
};

const PendingOrders = () => {
  return (
    <CheckoutProvider>
      <Pending />
    </CheckoutProvider>
  );
};
