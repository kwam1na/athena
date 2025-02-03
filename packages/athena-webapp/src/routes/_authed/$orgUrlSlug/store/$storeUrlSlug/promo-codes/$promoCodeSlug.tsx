import { createFileRoute } from "@tanstack/react-router";
import AddPromoCodeView from "~/src/components/promo-codes/PromoCodeView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/promo-codes/$promoCodeSlug"
)({
  component: AddPromoCodeView,
});
