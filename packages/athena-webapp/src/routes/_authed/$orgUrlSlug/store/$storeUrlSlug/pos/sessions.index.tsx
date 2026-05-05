import { createFileRoute } from "@tanstack/react-router";

import { POSSessionsView } from "~/src/components/pos/sessions/POSSessionsView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/sessions/"
)({
  component: POSSessionsView,
  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const { data: payload } = data as Record<string, any>;
    const { org } = payload as Record<string, boolean>;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
