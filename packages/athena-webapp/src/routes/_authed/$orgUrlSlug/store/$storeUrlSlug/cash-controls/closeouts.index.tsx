import { createFileRoute, useParams } from "@tanstack/react-router";

import { CashControlsWorkspaceHeader } from "~/src/components/cash-controls/CashControlsWorkspaceHeader";
import { RegisterCloseoutView } from "~/src/components/cash-controls/RegisterCloseoutView";
import View from "~/src/components/View";
import { FadeIn } from "~/src/components/common/FadeIn";
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

function CashControlsCloseoutsRoute() {
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        params?.orgUrlSlug && params.storeUrlSlug ? (
          <CashControlsWorkspaceHeader
            activeView="closeouts"
            description="Count one drawer at a time, review flagged variances, and move the closeout queue forward without losing context."
            orgUrlSlug={params.orgUrlSlug}
            storeUrlSlug={params.storeUrlSlug}
            title="Register closeouts"
          />
        ) : null
      }
    >
      <FadeIn className="container mx-auto py-8">
        <RegisterCloseoutView />
      </FadeIn>
    </View>
  );
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/cash-controls/closeouts/"
)({
  component: CashControlsCloseoutsRoute,
  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const org = hasOrgNotFoundPayload(data);

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
