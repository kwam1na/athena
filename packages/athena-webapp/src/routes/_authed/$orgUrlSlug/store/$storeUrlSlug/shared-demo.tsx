import { createFileRoute } from "@tanstack/react-router";
import { SharedDemoOwnerHome } from "@/components/shared-demo/SharedDemoOwnerHome";
import { getSharedDemoRoutes } from "@/components/shared-demo/sharedDemoRoutes";

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/$storeUrlSlug/shared-demo")({ component: SharedDemoHomeRoute });

export function SharedDemoHomeRoute() {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  return <SharedDemoOwnerHome routes={getSharedDemoRoutes(orgUrlSlug, storeUrlSlug)} />;
}
