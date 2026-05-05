import { createFileRoute } from "@tanstack/react-router";
import { ArchivedProducts } from "~/src/components/products/ArchivedProducts";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/archived",
)({
  component: ArchivedProducts,
});
