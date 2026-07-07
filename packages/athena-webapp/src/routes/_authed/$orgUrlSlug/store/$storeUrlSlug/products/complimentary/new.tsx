import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";
import { AddComplimentaryProduct } from "~/src/components/products/complimentary/AddComplimentaryProduct";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/complimentary/new"
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <AddComplimentaryProduct />
    </ProtectedRoute>
  ),
});
