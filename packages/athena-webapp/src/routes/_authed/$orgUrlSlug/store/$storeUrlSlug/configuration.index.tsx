import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";
import { StoreConfiguration } from "~/src/components/store-configuration";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/configuration/"
)({
  component: () => (
    <ProtectedRoute requires="full_admin">
      <StoreConfiguration />
    </ProtectedRoute>
  ),
});
