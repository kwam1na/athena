import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyOpeningView } from "~/src/components/operations/DailyOpeningView";
import { useDailyOpeningFixture } from "~/src/stories/operations/devFixtureActivation";

const dailyOpeningSearchSchema = z.object({
  // Development-only screenshot fixtures; inert in production builds.
  fixture: z.string().optional(),
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
  const { fixture: fixtureName } = Route.useSearch();
  const { fixture, isResolving } = useDailyOpeningFixture(fixtureName);

  // Hold the render while a fixture loads, so the workspace never briefly takes the
  // Convex path and issues the queries the fixture exists to avoid.
  if (isResolving) return null;

  return <DailyOpeningView fixture={fixture} />;
}
