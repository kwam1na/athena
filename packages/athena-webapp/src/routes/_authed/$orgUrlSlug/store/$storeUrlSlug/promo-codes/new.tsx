import { createFileRoute } from "@tanstack/react-router";
import AddPromoCodeView from "~/src/components/promo-codes/AddPromoCodeView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/promo-codes/new"
)({
  component: AddPromoCodeView,
});
