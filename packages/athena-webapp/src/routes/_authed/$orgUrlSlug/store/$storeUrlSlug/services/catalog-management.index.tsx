import { createFileRoute } from "@tanstack/react-router";
import { ServiceCatalogView } from "~/src/components/services/ServiceCatalogView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/services/catalog-management/"
)({
  component: ServiceCatalogView,
});
