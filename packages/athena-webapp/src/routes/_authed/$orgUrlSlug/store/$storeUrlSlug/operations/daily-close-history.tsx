import { createFileRoute } from "@tanstack/react-router";

import { DailyCloseHistoryView } from "~/src/components/operations/DailyCloseHistoryView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history",
)({
  component: DailyCloseHistoryRoute,
});

function DailyCloseHistoryRoute() {
  return <DailyCloseHistoryView />;
}
