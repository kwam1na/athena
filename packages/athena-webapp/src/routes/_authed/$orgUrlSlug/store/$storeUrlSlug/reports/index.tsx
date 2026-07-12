import { createFileRoute } from "@tanstack/react-router";
import { ReportsOverviewView } from "@/components/reports/ReportsOverviewView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/",
)({
  component: ReportsOverviewRoute,
});

function ReportsOverviewRoute() {
  const search = Route.useSearch();
  return (
    <ReportsOverviewView
      periodKey={search.preset ?? "wtd"}
      runId={search.runId}
    />
  );
}
