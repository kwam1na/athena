import { createFileRoute } from "@tanstack/react-router";

import { DailyCloseView } from "~/src/components/operations/DailyCloseView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
)({
  component: DailyCloseRoute,
});

function DailyCloseRoute() {
  return <DailyCloseView />;
}
