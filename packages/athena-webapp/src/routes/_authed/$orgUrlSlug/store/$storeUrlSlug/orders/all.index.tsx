import { createFileRoute } from "@tanstack/react-router";
import OrdersView from "~/src/components/orders/OrdersView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/orders/all/"
)({
  component: () => <OrdersView status="all" />,
});
