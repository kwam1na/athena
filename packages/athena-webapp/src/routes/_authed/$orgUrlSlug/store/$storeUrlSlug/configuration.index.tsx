import { createFileRoute } from "@tanstack/react-router";
import { StoreConfiguration } from "~/src/components/store-configuration";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/configuration/"
)({
  component: () => <StoreConfiguration />,
});
