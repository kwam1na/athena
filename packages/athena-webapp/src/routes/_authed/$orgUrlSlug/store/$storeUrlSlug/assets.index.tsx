import { createFileRoute } from "@tanstack/react-router";
import { StoreAssets } from "~/src/components/assets";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/assets/"
)({
  component: () => (
    <ProtectedRoute requires="full_admin">
      <StoreAssets />
    </ProtectedRoute>
  ),
});
