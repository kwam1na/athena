import type { ReactNode } from "react";

import { createWorkflowTraceId } from "~/shared/workflowTrace";
import {
  WorkflowTraceRouteLink,
  getWorkflowTraceRouteTarget,
} from "~/src/components/traces/WorkflowTraceRouteLink";

type WorkflowTraceLinkTarget = {
  traceId: string;
  to: "/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId";
  params: (prev: {
    orgUrlSlug?: string;
    storeUrlSlug?: string;
  }) => {
    orgUrlSlug: string;
    storeUrlSlug: string;
    traceId: string;
  };
  search: {
    o: string;
  };
};

export function getWorkflowTraceLinkTarget(
  transactionNumber: string
): WorkflowTraceLinkTarget {
  return getWorkflowTraceRouteTarget(
    createWorkflowTraceId({
      workflowType: "pos_sale",
      primaryLookupValue: transactionNumber,
    }),
  );
}

export function WorkflowTraceLink({
  transactionNumber,
  children,
  className = "text-sm font-medium text-primary",
}: {
  transactionNumber: string;
  children?: ReactNode;
  className?: string;
}) {
  const target = getWorkflowTraceLinkTarget(transactionNumber);

  return (
    <WorkflowTraceRouteLink traceId={target.traceId} className={className}>
      {children ?? "View trace"}
    </WorkflowTraceRouteLink>
  );
}
