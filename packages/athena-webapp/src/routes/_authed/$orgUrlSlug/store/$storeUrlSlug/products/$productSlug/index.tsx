import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";
import { ProductDetailView } from "~/src/components/product/ProductDetailView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/"
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <ProductDetailView />
    </ProtectedRoute>
  ),
});
