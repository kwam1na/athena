import { createFileRoute } from "@tanstack/react-router";

import { OperationsQueueView } from "~/src/components/operations/OperationsQueueView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
)({
  component: ApprovalsRoute,
});

function ApprovalsRoute() {
  return <OperationsQueueView activeWorkflow="approvals" />;
}
