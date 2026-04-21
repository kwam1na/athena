import { createFileRoute } from "@tanstack/react-router";

import { RegisterSessionView } from "~/src/components/cash-controls/RegisterSessionView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

function hasOrgNotFoundPayload(data: unknown) {
  if (!data || typeof data !== "object" || !("data" in data)) {
    return false;
  }

  const payload = data.data;
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "org" in payload &&
      typeof payload.org === "boolean" &&
      payload.org,
  );
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
)({
  component: RegisterSessionView,
  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const org = hasOrgNotFoundPayload(data);

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
