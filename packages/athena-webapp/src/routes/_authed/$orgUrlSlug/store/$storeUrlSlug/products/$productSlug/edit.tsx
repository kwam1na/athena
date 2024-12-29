import { createFileRoute } from "@tanstack/react-router";
import ProductView from "~/src/components/ProductView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
)({
  component: ProductView,
});
