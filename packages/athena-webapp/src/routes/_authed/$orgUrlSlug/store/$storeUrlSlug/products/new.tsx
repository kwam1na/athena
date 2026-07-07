import ProductView from "~/src/components/add-product/ProductView";
import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/new"
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <ProductView />
    </ProtectedRoute>
  ),
});
