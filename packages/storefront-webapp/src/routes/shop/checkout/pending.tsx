import { FadeIn } from "@/components/common/FadeIn";
import { useStoreContext } from "@/contexts/StoreContext";
import { checkoutSessionQueries } from "@/queries";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/shop/checkout/pending")({
  component: () => <PendingOrders />,
});

const PendingOrders = () => {
  const { userId, organizationId, storeId, formatter } = useStoreContext();

  const { data: pendingOrders, isLoading } = useQuery(
    checkoutSessionQueries.pendingSessions({
      userId: userId!,
      organizationId,
      storeId,
    })
  );

  if (isLoading) return <div className="h-screen" />;

  return (
    <FadeIn className="container mx-auto max-w-[1024px] min-h-screen px-6 xl:px-0 space-y-8 lg:space-y-24 py-8">
      <p>Pending orders</p>

      <div className="grid grid-cols-1 gap-8">
        {pendingOrders?.map((session: any) => {
          return (
            <Link
              to="/shop/checkout/$sessionIdSlug"
              params={{ sessionIdSlug: session._id }}
              key={session._id}
              className="flex gap-2 hover:underline"
            >
              <p className="text-sm font-medium">{`${formatter.format(session.amount / 100)} order placed on ${new Date(session._creationTime).toDateString()}`}</p>
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
          );
        })}
      </div>
    </FadeIn>
  );
};
