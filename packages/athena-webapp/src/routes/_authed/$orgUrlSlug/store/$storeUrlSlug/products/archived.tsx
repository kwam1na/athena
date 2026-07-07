import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";
import { ArchivedProducts } from "~/src/components/products/ArchivedProducts";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/archived",
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <ArchivedProducts />
    </ProtectedRoute>
  ),
});
