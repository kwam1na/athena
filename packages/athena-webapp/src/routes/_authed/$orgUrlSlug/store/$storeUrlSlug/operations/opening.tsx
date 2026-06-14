import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyOpeningView } from "~/src/components/operations/DailyOpeningView";

const dailyOpeningSearchSchema = z.object({
  operatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tab: z.enum(["blocked", "carry-forward", "ready", "review"]).optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
)({
  component: DailyOpeningRoute,
  validateSearch: dailyOpeningSearchSchema,
});

function DailyOpeningRoute() {
  return <DailyOpeningView />;
}
