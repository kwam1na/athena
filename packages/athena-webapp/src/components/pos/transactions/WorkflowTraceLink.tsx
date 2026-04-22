import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";

import { createWorkflowTraceId } from "~/shared/workflowTrace";
import { getOrigin } from "~/src/lib/navigationUtils";

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
  const traceId = createWorkflowTraceId({
    workflowType: "pos_sale",
    primaryLookupValue: transactionNumber,
  });

  return {
    traceId,
    to: "/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId",
    params: (prev) => ({
      ...prev,
      orgUrlSlug: prev.orgUrlSlug!,
      storeUrlSlug: prev.storeUrlSlug!,
      traceId,
    }),
    search: {
      o: getOrigin(),
    },
  };
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
    <Link
      to={target.to}
      params={target.params}
      search={target.search}
      className={className}
    >
      {children ?? "View trace"}
    </Link>
  );
}
