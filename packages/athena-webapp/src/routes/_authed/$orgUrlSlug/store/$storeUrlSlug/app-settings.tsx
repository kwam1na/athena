import { createFileRoute } from "@tanstack/react-router";

import { AppSettingsView } from "@/components/app-settings/AppSettingsView";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/app-settings",
)({
  component: () => (
    <ProtectedRoute requires="full_admin">
      <AppSettingsView />
    </ProtectedRoute>
  ),
});
