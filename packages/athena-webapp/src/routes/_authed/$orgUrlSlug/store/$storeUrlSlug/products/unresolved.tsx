import { createFileRoute } from "@tanstack/react-router";
import { UnresolvedProducts } from "~/src/components/products/UnresolvedProducts";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/unresolved"
)({
  component: UnresolvedProducts,
});
