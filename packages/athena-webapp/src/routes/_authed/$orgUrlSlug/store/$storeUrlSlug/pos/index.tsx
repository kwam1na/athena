import { createFileRoute } from "@tanstack/react-router";
import PointOfSaleView from "~/src/components/pos/PointOfSaleView";
import { PosClientTelemetryHost } from "~/src/components/pos/PosClientTelemetryHost";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

function PointOfSaleRoute() {
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
});
