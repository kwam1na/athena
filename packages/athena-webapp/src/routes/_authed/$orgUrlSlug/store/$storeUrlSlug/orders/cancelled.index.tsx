import { createFileRoute } from "@tanstack/react-router";
import OrdersView from "~/src/components/orders/OrdersView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/orders/cancelled/"
)({
  component: () => <OrdersView status="cancelled" />,
});
