import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import PointOfSaleView from "~/src/components/pos/PointOfSaleView";
import { PosClientTelemetryHost } from "~/src/components/pos/PosClientTelemetryHost";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import { usePosHubFixture } from "~/src/stories/operations/devFixtureActivation";

const pointOfSaleSearchSchema = z.object({
  // Development-only screenshot fixture; inert in production builds.
  fixture: z.string().optional(),
});

function PointOfSaleRoute() {
  const { fixture: fixtureName } = Route.useSearch();
  const { fixture, isResolving } = usePosHubFixture(fixtureName);

  // Hold the render while a fixture loads, so the hub never briefly takes the
  // Convex path and issues the queries the fixture exists to avoid.
  if (isResolving) return null;

  // In fixture mode the authored hub stands alone — no live telemetry side
  // effects behind the screenshot.
  if (fixture) return <PointOfSaleView fixture={fixture} />;

  return (
    <>
      <PosClientTelemetryHost />
      <PointOfSaleView />
    </>
  );
}

function PointOfSaleNotFoundRoute({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const { data: d } = data as Record<string, unknown>;
  const { org } = d as Record<string, boolean>;

  const entity = org ? "organization" : "store";
  const name = org ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/"
)({
  component: PointOfSaleRoute,

  notFoundComponent: PointOfSaleNotFoundRoute,
  validateSearch: pointOfSaleSearchSchema,
});
