import ComplimentaryProductsView from "~/src/components/products/complimentary/ComplimentaryProductsView";
import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/complimentary/"
)({
  component: ComplimentaryProductsView,
  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const { data: d } = data as Record<string, any>;
    const { org } = d as Record<string, boolean>;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
