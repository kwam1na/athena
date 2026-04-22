import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { Id } from "~/convex/_generated/dataModel";

import { WorkflowTraceView } from "~/src/components/traces/WorkflowTraceView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import View from "~/src/components/View";
import { FadeIn } from "~/src/components/common/FadeIn";
import { api } from "~/convex/_generated/api";
import { useAuth } from "@/hooks/useAuth";

function hasOrgNotFoundPayload(data: unknown) {
  return Boolean(
    data &&
      typeof data === "object" &&
      "data" in data &&
      (data as { data?: { org?: boolean } }).data?.org === true,
  );
}

function WorkflowTraceLoadingState() {
  return (
    <View>
      <FadeIn>
        <div className="container mx-auto p-6">
          <p className="text-sm text-muted-foreground">
            Loading workflow trace...
          </p>
        </div>
      </FadeIn>
    </View>
  );
}

export function WorkflowTraceRouteContent({
  organizationId,
  storeUrlSlug,
  traceId,
}: {
  organizationId?: Id<"organization">;
  storeUrlSlug: string;
  traceId: string;
}) {
  const stores = useQuery(
    api.inventory.stores.getAll,
    organizationId ? { organizationId } : "skip",
  );

  if (!organizationId || !traceId || stores === undefined) {
    return <WorkflowTraceLoadingState />;
  }

  const matchedStore = stores.find((store) => store.slug === storeUrlSlug);

  if (!matchedStore) {
    return (
      <NotFoundView entity="store" entityIdentifier={storeUrlSlug} />
    );
  }

  return (
    <WorkflowTraceView storeId={matchedStore._id} traceId={traceId} />
  );
}

export function WorkflowTraceRouteShell({
  orgUrlSlug,
  storeUrlSlug,
  traceId,
}: {
  orgUrlSlug: string;
  storeUrlSlug: string;
  traceId: string;
}) {
  const { user, isLoading: isLoadingAuth } = useAuth();

  const organizations = useQuery(
    api.inventory.organizations.getAll,
    user?._id ? { userId: user._id } : "skip",
  );

  if (isLoadingAuth || organizations === undefined || !traceId) {
    return <WorkflowTraceLoadingState />;
  }

  const organization = organizations.find((org) => org.slug === orgUrlSlug);

  if (!organization) {
    return <NotFoundView entity="organization" entityIdentifier={orgUrlSlug} />;
  }

  return (
    <WorkflowTraceRouteContent
      organizationId={organization._id}
      storeUrlSlug={storeUrlSlug}
      traceId={traceId}
    />
  );
}

export function WorkflowTraceRoute() {
  const { orgUrlSlug, storeUrlSlug, traceId } = Route.useParams();

  return (
    <WorkflowTraceRouteShell
      orgUrlSlug={orgUrlSlug}
      storeUrlSlug={storeUrlSlug}
      traceId={traceId}
    />
  );
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId",
)({
  component: WorkflowTraceRoute,
  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const org = hasOrgNotFoundPayload(data);

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
