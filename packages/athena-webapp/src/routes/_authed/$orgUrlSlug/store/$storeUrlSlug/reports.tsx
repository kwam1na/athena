import { createFileRoute } from "@tanstack/react-router";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ReportsLayout } from "@/components/reports/ReportsLayout";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports",
)({
  component: () => (
    <ProtectedRoute requires="full_admin">
      <ReportsLayout />
    </ProtectedRoute>
  ),
});
