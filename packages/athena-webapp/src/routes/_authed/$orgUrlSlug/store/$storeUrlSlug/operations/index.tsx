import { createFileRoute } from "@tanstack/react-router";
import { DailyOperationsView } from "~/src/components/operations/DailyOperationsView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/",
)({
  component: DailyOperationsView,
});
