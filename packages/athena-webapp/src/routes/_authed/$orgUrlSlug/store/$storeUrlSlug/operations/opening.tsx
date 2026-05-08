import { createFileRoute } from "@tanstack/react-router";

import { DailyOpeningView } from "~/src/components/operations/DailyOpeningView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
)({
  component: DailyOpeningRoute,
});

function DailyOpeningRoute() {
  return <DailyOpeningView />;
}
