import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyCloseHistoryView } from "~/src/components/operations/DailyCloseHistoryView";

const dailyCloseHistorySearchSchema = z.object({
  day: z.string().optional(),
  o: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history",
)({
  component: DailyCloseHistoryRoute,
  validateSearch: dailyCloseHistorySearchSchema,
});

function DailyCloseHistoryRoute() {
  return <DailyCloseHistoryView />;
}
