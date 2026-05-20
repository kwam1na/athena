import { createFileRoute } from "@tanstack/react-router";

import { POSTerminalDetailView } from "~/src/components/pos/terminals/POSTerminalDetailView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

type NotFoundPayload = {
  data?: {
    org?: boolean;
  };
};

function POSTerminalDetailNotFoundRoute({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const payload = data as NotFoundPayload | undefined;
  const org = Boolean(payload?.data?.org);

  const entity = org ? "organization" : "store";
  const name = org ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/$terminalId"
)({
  component: POSTerminalDetailView,
  notFoundComponent: POSTerminalDetailNotFoundRoute,
});
