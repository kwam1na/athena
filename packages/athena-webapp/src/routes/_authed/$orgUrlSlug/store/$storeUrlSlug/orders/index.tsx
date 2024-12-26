import { createFileRoute } from "@tanstack/react-router";
import OrdersView from "~/src/components/orders/OrdersView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/orders/"
)({
  component: OrdersView,

  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const { data: d } = data as Record<string, any>;
    const { org } = d as Record<string, boolean>;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
