import { createFileRoute } from "@tanstack/react-router";
import { ServicesWorkspaceView } from "~/src/components/services/ServicesWorkspaceView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/services/",
)({
  component: ServicesWorkspaceView,
});
