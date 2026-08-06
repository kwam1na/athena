import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DailyOperationsView } from "~/src/components/operations/DailyOperationsView";
import { useDailyOperationsFixture } from "~/src/stories/operations/devFixtureActivation";

export const dailyOperationsSearchSchema = z.object({
  // Development-only screenshot fixtures; inert in production builds.
  fixture: z.string().optional(),
  o: z.string().optional(),
  /**
   * Where to put the visitor back after a sheet on this page sends them
   * somewhere else — see `lib/sheetReturn`. Deliberately the same name on
   * every route that hosts a sheet, so one codec parses all of them.
   *
   * Untyped beyond `string` on purpose: the value is opaque here and the codec
   * treats anything unparseable as no token, so a malformed URL degrades to
   * "no restore" rather than failing route validation and blanking the page.
   */
  sheetReturn: z.string().optional(),
  operatingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timeline: z.literal("open").optional(),
  weekEndOperatingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
