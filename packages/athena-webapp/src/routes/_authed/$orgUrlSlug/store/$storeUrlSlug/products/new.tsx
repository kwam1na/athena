import ProductView from "~/src/components/add-product/ProductView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/new"
)({
  component: ProductView,
});
