import { createFileRoute } from "@tanstack/react-router";
import { LogView } from "~/src/components/app-logs/LogView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/logs/$logId"
)({
  component: LogView,
});
