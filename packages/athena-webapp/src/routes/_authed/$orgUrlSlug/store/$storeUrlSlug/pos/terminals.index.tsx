import { createFileRoute } from "@tanstack/react-router";

import { POSTerminalHealthView } from "~/src/components/pos/terminals/POSTerminalHealthView";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

type NotFoundPayload = {
  data?: {
    org?: boolean;
  };
};

function POSTerminalHealthNotFoundRoute({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const payload = data as NotFoundPayload | undefined;
  const org = Boolean(payload?.data?.org);

  const entity = org ? "organization" : "store";
  const name = org ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/"
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <POSTerminalHealthView />
    </ProtectedRoute>
  ),
  notFoundComponent: POSTerminalHealthNotFoundRoute,
});
