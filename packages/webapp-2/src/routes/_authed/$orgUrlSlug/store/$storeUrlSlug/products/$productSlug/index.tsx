import ProductView from "@/components/ProductView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/"
)({
  component: ProductView,
});
