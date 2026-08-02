import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { EmptyState } from "@/components/states/empty/empty-state";
import { ReportsWeeklyView } from "@/components/reports/ReportsWeeklyView";
import { reportsWeeklySearchSchema } from "@/components/reports/reportRouteSearch";
import { useStableReportQuery } from "@/components/reports/useStableReportQuery";
import { weeklyLifecycleLabel } from "@/components/reports/weeklyReportPresentation";
import { Button } from "@/components/ui/button";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";

export { reportsWeeklySearchSchema } from "@/components/reports/reportRouteSearch";

function unavailableWeeklyCopy(reason: string | null) {
  if (reason === "capability_disabled") {
    return {
      title: "Weekly report unavailable",
      description: "Weekly reporting has not been enabled for this store.",
    };
  }
  if (reason === "missing_schedule") {
    return {
      title: "Store hours needed",
      description:
        "Add a Store hours schedule before Athena can determine this reporting week.",
    };
  }
  if (reason === "missing_timezone") {
    return {
      title: "Store time zone needed",
      description:
        "Set the Store hours time zone before Athena can determine this reporting week.",
    };
  }
  if (reason === "no_scheduled_dates") {
    return {
      title: "No scheduled dates",
      description:
        "This reporting week has no operational dates. Review Store hours to make a date operational.",
    };
  }
  return {
    title: "Weekly report is materializing",
    description:
      "Athena is preparing the store's first weekly projection. Check again after reporting activity finishes materializing.",
  };
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/weekly",
)({
  component: ReportsWeeklyRoute,
  validateSearch: reportsWeeklySearchSchema,
});

export function ReportsWeeklyRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { activeStore } = useGetActiveStore();
  const selectedReportId = search.reportId;

  // One projection query at a time: active OR selected historical detail.
  // History starts only when the operator opens the selector, keeping Weekly
  // at a maximum of two compact Reports subscriptions.
  const active = useQuery(
    api.reports.queries.getActiveWeeklyBriefing,
    activeStore?._id && !selectedReportId
      ? { storeId: activeStore._id }
      : "skip",
  );
  const selectedDetail = useQuery(
    api.reports.queries.getAcceptedWeeklyDetail,
    activeStore?._id && selectedReportId
      ? { storeId: activeStore._id, reportId: selectedReportId }
      : "skip",
  );
  const history = useQuery(
    api.reports.queries.listAcceptedWeeklyHistory,
    activeStore?._id && search.history
      ? {
          storeId: activeStore._id,
          paginationOpts: {
            cursor: search.historyCursor ?? null,
            numItems: 12,
          },
        }
      : "skip",
  );
  const stableActive = useStableReportQuery(active, "active");
  const stableDetail = useStableReportQuery(
    selectedDetail,
    selectedReportId ? `history:${selectedReportId}` : undefined,
  );
  const stable = selectedReportId ? stableDetail : stableActive;

  if (
    activeStore === null ||
    stable.isInitialLoad ||
    stable.data === undefined
  ) {
    return null;
  }

  const report = selectedReportId
    ? (stableDetail.data ?? null)
    : stableActive.data?.status === "available"
      ? (stableActive.data.acceptedBaseline ?? stableActive.data.current)
      : null;
  const historyEntries = history?.page ?? [];
  const historyCursorTrail = search.historyCursorTrail ?? [];
  const unavailableReason =
    !selectedReportId && stableActive.data?.status === "unavailable"
      ? stableActive.data.reason
      : null;
  const unavailableCopy = unavailableWeeklyCopy(unavailableReason);

  return (
    <div className="space-y-layout-xl md:space-y-layout-2xl">
      <div className="flex flex-wrap items-center justify-between gap-layout-sm">
        <div aria-live="polite" className="text-sm text-muted-foreground">
          {stable.isRefreshing
            ? "Loading reporting week."
            : report
              ? `Showing ${report.cycleStartDate} through ${report.cycleEndDate}. ${weeklyLifecycleLabel(report)}.`
              : unavailableReason === "missing_projection"
                ? "Weekly reporting is materializing."
                : "Weekly reporting is unavailable."}
        </div>
        <Button
          aria-expanded={search.history === true}
          onClick={() =>
            void navigate({
              search: (current) => ({
                ...current,
                history: current.history ? undefined : true,
                historyCursor: undefined,
                historyCursorTrail: undefined,
              }),
            })
          }
          size="sm"
          variant="outline"
        >
          {search.history ? "Close history" : "Weekly history"}
        </Button>
      </div>

      {search.history ? (
        <section
          aria-label="Weekly report history"
          className="border-y border-border py-layout-md"
        >
          {history === undefined ? (
            <p className="text-sm text-muted-foreground">
              Loading weekly history.
            </p>
          ) : historyEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accepted weeks yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-layout-sm">
              {historyEntries.map((entry) => (
                <Button
                  aria-pressed={entry.reportId === selectedReportId}
                  key={entry.reportId}
                  onClick={() =>
                    void navigate({
                      search: (current) => ({
                        ...current,
                        reportId: entry.reportId,
                      }),
                    })
                  }
                  size="sm"
                  variant={
                    entry.reportId === selectedReportId ? "default" : "outline"
                  }
                >
                  {entry.cycleStartDate} – {entry.cycleEndDate}
                </Button>
              ))}
            </div>
          )}
          {historyCursorTrail.length > 0 ||
          (history && !history.isDone && history.continueCursor) ? (
            <div className="mt-layout-md flex flex-wrap gap-layout-sm">
              {historyCursorTrail.length > 0 ? (
                <Button
                  onClick={() =>
                    void navigate({
                      search: (current) => {
                        const trail = current.historyCursorTrail ?? [];
                        const previousCursor = trail.at(-1) ?? null;
                        const remainingTrail = trail.slice(0, -1);
                        return {
                          ...current,
                          history: true,
                          historyCursor: previousCursor ?? undefined,
                          historyCursorTrail:
                            remainingTrail.length > 0
                              ? remainingTrail
                              : undefined,
                        };
                      },
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  Newer accepted weeks
                </Button>
              ) : null}
              {history && !history.isDone && history.continueCursor ? (
                <Button
                  onClick={() =>
                    void navigate({
                      search: (current) => ({
                        ...current,
                        history: true,
                        historyCursor: history.continueCursor,
                        historyCursorTrail: [
                          ...(current.historyCursorTrail ?? []),
                          current.historyCursor ?? null,
                        ],
                      }),
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  Older accepted weeks
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {report ? (
        <ReportsWeeklyView ownerReturnContext={search} report={report} />
      ) : (
        <EmptyState
          description={
            selectedReportId
              ? "This accepted reporting week is no longer available. Choose another week from history."
              : unavailableCopy.description
          }
          title={
            selectedReportId
              ? "Accepted week unavailable"
              : unavailableCopy.title
          }
        />
      )}
    </div>
  );
}
