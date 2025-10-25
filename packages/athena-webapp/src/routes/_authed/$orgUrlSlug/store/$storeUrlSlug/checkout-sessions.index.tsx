import { createFileRoute } from "@tanstack/react-router";
import { CheckoutSesssionsView } from "~/src/components/checkout-sessions/CheckoutSesssionsView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/checkout-sessions/"
)({
  component: () => <CheckoutSesssionsView />,
});
