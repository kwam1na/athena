import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";
import { UnresolvedProducts } from "~/src/components/products/UnresolvedProducts";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/unresolved"
)({
  component: () => (
    <ProtectedRoute requires="full_admin">
      <UnresolvedProducts />
    </ProtectedRoute>
  ),
});
