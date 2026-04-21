import { createFileRoute } from "@tanstack/react-router";
import { ServiceIntakeView } from "~/src/components/services/ServiceIntakeView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/services/intake/"
)({
  component: ServiceIntakeView,
});
