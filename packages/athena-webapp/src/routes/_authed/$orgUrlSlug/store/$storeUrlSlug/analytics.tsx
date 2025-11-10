import { createFileRoute } from "@tanstack/react-router";
import AnalyticsView from "~/src/components/analytics/AnalyticsView";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/analytics"
)({
  component: () => (
    <ProtectedRoute requires="full_admin">
      <AnalyticsView />
    </ProtectedRoute>
  ),
});
