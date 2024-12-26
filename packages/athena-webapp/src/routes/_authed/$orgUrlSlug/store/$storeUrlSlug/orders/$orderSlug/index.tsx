import { createFileRoute } from "@tanstack/react-router";
import { OrderView } from "~/src/components/orders/OrderView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug/"
)({
  component: () => <OrderView />,
});
