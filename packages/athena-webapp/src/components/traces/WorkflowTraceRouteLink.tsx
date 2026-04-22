import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";

import { getOrigin } from "~/src/lib/navigationUtils";

type WorkflowTraceRouteTarget = {
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

export function getWorkflowTraceRouteTarget(
  traceId: string,
): WorkflowTraceRouteTarget {
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

export function WorkflowTraceRouteLink({
  traceId,
  children,
  className = "text-sm font-medium text-primary",
}: {
  traceId: string;
  children?: ReactNode;
  className?: string;
}) {
  const target = getWorkflowTraceRouteTarget(traceId);

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
