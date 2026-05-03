import { createFileRoute } from "@tanstack/react-router";

import { OperationsQueueView } from "~/src/components/operations/OperationsQueueView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments",
)({
  component: StockAdjustmentsRoute,
});

function StockAdjustmentsRoute() {
  return <OperationsQueueView activeWorkflow="stock" />;
}
