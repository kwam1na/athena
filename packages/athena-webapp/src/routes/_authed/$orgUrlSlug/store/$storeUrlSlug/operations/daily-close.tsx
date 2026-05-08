import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyCloseView } from "~/src/components/operations/DailyCloseView";

const dailyCloseSearchSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  tab: z.enum(["blocked", "carry-forward", "ready", "review"]).optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
)({
  component: DailyCloseRoute,
  validateSearch: dailyCloseSearchSchema,
});

function DailyCloseRoute() {
  return <DailyCloseView />;
}
