import { createFileRoute } from "@tanstack/react-router";
import { StoreAssets } from "~/src/components/assets";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/assets/"
)({
  component: () => <StoreAssets />,
});
