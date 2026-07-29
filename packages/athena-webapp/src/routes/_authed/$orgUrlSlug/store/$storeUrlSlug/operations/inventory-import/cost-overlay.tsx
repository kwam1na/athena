import { createFileRoute } from "@tanstack/react-router";

import { InventoryCostOverlayView } from "~/src/components/operations/InventoryCostOverlayView";
import { inventoryCostOverlaySearchSchema } from "./-cost-overlay-search";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import/cost-overlay",
)({
  component: InventoryCostOverlayView,
  validateSearch: inventoryCostOverlaySearchSchema,
});
