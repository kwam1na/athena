import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyOperationsView } from "~/src/components/operations/DailyOperationsView";

const dailyOperationsSearchSchema = z.object({
  operatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weekEndOperatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/",
)({
  component: DailyOperationsView,
  validateSearch: dailyOperationsSearchSchema,
});
