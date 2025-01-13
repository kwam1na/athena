import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import StoreView from "@/components/StoreView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/")({
  component: StoreView,

  notFoundComponent: () => {
    const { orgUrlSlug } = Route.useParams();
    return <NotFoundView entity="organization" entityIdentifier={orgUrlSlug} />;
  },
});
