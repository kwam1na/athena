import { createFileRoute } from "@tanstack/react-router";

import { InventoryImportRoute } from "./-inventory-import-route";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import",
)({
  component: InventoryImportRoute,
});
