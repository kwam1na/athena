import { Link, createFileRoute, useParams } from "@tanstack/react-router";

import { RegisterCloseoutView } from "~/src/components/cash-controls/RegisterCloseoutView";
import View from "~/src/components/View";
import { FadeIn } from "~/src/components/common/FadeIn";
import { SimplePageHeader } from "~/src/components/common/PageHeader";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import { Button } from "~/src/components/ui/button";

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
      header={
        <SimplePageHeader
          className="text-lg font-semibold"
          title="Register Closeouts"
        />
      }
    >
      <FadeIn>
        <div className="container mx-auto space-y-6 p-6">
          {params?.orgUrlSlug && params.storeUrlSlug ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link
                  params={{
                    orgUrlSlug: params.orgUrlSlug,
                    storeUrlSlug: params.storeUrlSlug,
                  }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
                >
                  Overview
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link
                  params={{
                    orgUrlSlug: params.orgUrlSlug,
                    storeUrlSlug: params.storeUrlSlug,
                  }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers"
                >
                  Registers
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link
                  params={{
                    orgUrlSlug: params.orgUrlSlug,
                    storeUrlSlug: params.storeUrlSlug,
                  }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/closeouts"
                >
                  Closeouts
                </Link>
              </Button>
            </div>
          ) : null}

          <RegisterCloseoutView />
        </div>
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
