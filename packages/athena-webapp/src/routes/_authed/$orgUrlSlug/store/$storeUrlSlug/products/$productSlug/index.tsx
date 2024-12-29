import { createFileRoute } from "@tanstack/react-router";
import { ProductDetailView } from "~/src/components/product/ProductDetailView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/"
)({
  component: ProductDetailView,
});
