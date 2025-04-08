import { createFileRoute } from "@tanstack/react-router";
import LogsView from "~/src/components/app-logs/LogsView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/logs/"
)({
  component: LogsView,
});
