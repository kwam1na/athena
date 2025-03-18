import { createFileRoute } from "@tanstack/react-router";
import BagItemsView from "~/src/components/user-bags/BagItemsView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/bags/"
)({
  component: () => <BagItemsView />,
});
