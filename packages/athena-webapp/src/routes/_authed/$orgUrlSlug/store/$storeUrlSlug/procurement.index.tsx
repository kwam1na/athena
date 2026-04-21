import { createFileRoute } from "@tanstack/react-router";
import { ProcurementView } from "~/src/components/procurement/ProcurementView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/procurement/"
)({
  component: ProcurementView,
});
