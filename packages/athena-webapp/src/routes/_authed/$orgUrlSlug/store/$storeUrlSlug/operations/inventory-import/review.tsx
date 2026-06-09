import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { InventoryImportView } from "~/src/components/operations/InventoryImportView";

const inventoryImportReviewSearchSchema = z.object({
  filter: z.enum(["all", "review", "new", "matched", "decided"]).optional(),
  page: z.coerce.number().int().positive().optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import/review",
)({
  component: () => <InventoryImportView mode="review" />,
  validateSearch: inventoryImportReviewSearchSchema,
});
