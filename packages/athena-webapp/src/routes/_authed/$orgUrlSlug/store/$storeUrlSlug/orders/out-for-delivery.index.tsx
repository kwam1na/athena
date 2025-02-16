import { createFileRoute } from "@tanstack/react-router";
import OrdersView from "~/src/components/orders/OrdersView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/orders/out-for-delivery/"
)({
  component: () => <OrdersView status="out-for-delivery" />,
});
