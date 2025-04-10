import { createFileRoute } from "@tanstack/react-router";
import { BagView } from "~/src/components/user-bags/BagView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/bags/$bagId"
)({
  component: BagView,
});
