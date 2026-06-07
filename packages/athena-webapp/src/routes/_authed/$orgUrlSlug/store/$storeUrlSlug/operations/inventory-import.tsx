import { createFileRoute } from "@tanstack/react-router";

import { InventoryImportView } from "~/src/components/operations/InventoryImportView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import",
)({
  component: InventoryImportView,
});
