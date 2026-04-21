import { createFileRoute } from "@tanstack/react-router";
import { ServiceCasesView } from "~/src/components/services/ServiceCasesView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/services/active-cases/"
)({
  component: ServiceCasesView,
});
