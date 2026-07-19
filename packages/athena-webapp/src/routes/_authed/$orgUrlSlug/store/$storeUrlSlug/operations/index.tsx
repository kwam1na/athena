import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyOperationsView } from "~/src/components/operations/DailyOperationsView";
import { useDailyOperationsFixture } from "~/src/stories/operations/devFixtureActivation";

const dailyOperationsSearchSchema = z.object({
  // Development-only screenshot fixtures; inert in production builds.
  fixture: z.string().optional(),
  operatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weekEndOperatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function DailyOperationsRoute() {
  const { fixture: fixtureName } = Route.useSearch();
  const { fixture, isResolving } = useDailyOperationsFixture(fixtureName);

  // Hold the render while a fixture loads, so the workspace never briefly takes the
  // Convex path and issues the queries the fixture exists to avoid.
  if (isResolving) return null;

  return <DailyOperationsView fixture={fixture} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/",
)({
  component: DailyOperationsRoute,
  validateSearch: dailyOperationsSearchSchema,
});
