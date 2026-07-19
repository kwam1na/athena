import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyCloseView } from "~/src/components/operations/DailyCloseView";
import { useDailyCloseFixture } from "~/src/stories/operations/devFixtureActivation";

const dailyCloseSearchSchema = z.object({
  // Development-only screenshot fixtures; inert in production builds.
  fixture: z.string().optional(),
  operatingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  readyPanels: z.string().optional(),
  report: z.enum(["transactions"]).optional(),
  tab: z.enum(["blocked", "carry-forward", "ready", "review"]).optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
)({
  component: DailyCloseRoute,
  validateSearch: dailyCloseSearchSchema,
});

function DailyCloseRoute() {
  const { fixture: fixtureName } = Route.useSearch();
  const { fixture, isResolving } = useDailyCloseFixture(fixtureName);

  // Hold the render while a fixture loads, so the workspace never briefly takes the
  // Convex path and issues the queries the fixture exists to avoid.
  if (isResolving) return null;

  return <DailyCloseView fixture={fixture} />;
}
