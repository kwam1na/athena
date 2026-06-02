import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { OperationsQueueView } from "~/src/components/operations/OperationsQueueView";
import type { StockAdjustmentSearchPatch } from "~/src/components/operations/StockAdjustmentWorkspace";

const stockAdjustmentSearchSchema = z.object({
  availability: z
    .enum(["all", "all_available", "changed", "unavailable"])
    .optional(),
  category: z.string().optional(),
  mode: z.enum(["cycle_count", "manual"]).optional(),
  o: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  query: z.string().optional(),
  sku: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments",
)({
  component: StockAdjustmentsRoute,
  validateSearch: stockAdjustmentSearchSchema,
});

function StockAdjustmentsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const handleStockAdjustmentSearchChange = (
    patch: StockAdjustmentSearchPatch,
  ) => {
    void navigate({
      replace: true,
      search: (current) => {
        const next = { ...current, ...patch };

        for (const key of [
          "availability",
          "category",
          "mode",
          "page",
          "query",
          "sku",
        ] as const) {
          if (next[key] === undefined || next[key] === "") {
            delete next[key];
          }
        }

        return next;
      },
    });
  };

  return (
    <OperationsQueueView
      activeWorkflow="stock"
      onStockAdjustmentSearchChange={handleStockAdjustmentSearchChange}
      stockAdjustmentSearch={search}
    />
  );
}
