import { createFileRoute } from "@tanstack/react-router";
import AnalyticsView from "~/src/components/analytics/AnalyticsView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/analytics"
)({
  component: () => <AnalyticsView />,
});
