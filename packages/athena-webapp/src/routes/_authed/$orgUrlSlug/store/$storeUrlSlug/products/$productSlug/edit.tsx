import { createFileRoute } from "@tanstack/react-router";
import ProductView from "~/src/components/add-product/ProductView";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <ProductView />
    </ProtectedRoute>
  ),
});
