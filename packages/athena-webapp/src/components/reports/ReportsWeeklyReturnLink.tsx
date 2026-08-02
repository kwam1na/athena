import { Link, useParams, useRouterState } from "@tanstack/react-router";

import { reportsWeeklyReturnFromState } from "./reportRouteSearch";

/** A history-state return is offered only after the full Weekly search validates. */
export function ReportsWeeklyReturnLink() {
  const state = useRouterState({ select: (router) => router.location.state });
  const search = reportsWeeklyReturnFromState(state);
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });

  if (!search || !orgUrlSlug || !storeUrlSlug) return null;

  return (
    <div className="mb-layout-md">
      <Link
        className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        params={{ orgUrlSlug, storeUrlSlug }}
        search={search}
        to="/$orgUrlSlug/store/$storeUrlSlug/reports/weekly"
      >
        Return to selected Weekly report
      </Link>
    </div>
  );
}
