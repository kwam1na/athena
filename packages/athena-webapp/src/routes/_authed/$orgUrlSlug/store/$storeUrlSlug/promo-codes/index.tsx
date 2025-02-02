import { createFileRoute } from "@tanstack/react-router";
import PromoCodesView from "~/src/components/promo-codes/PromoCodesView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/promo-codes/"
)({
  component: PromoCodesView,
});
