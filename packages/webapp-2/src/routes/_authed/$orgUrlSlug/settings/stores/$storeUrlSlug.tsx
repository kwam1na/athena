import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import StoreSettingsView from "@/settings/store/StoreSettingsView";
import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/settings/stores/$storeUrlSlug"
)({
  component: StoreSettingsView,

  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const { data: d } = data as Record<string, any>;
    const { org } = d as Record<string, boolean>;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
